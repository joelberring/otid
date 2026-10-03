package se.otid.station.store

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.nio.charset.StandardCharsets

fun interface StationConnectionFactory {
    fun open(url: String): HttpURLConnection
}

class AuthorizedStationHttpClient(
    private val connectionFactory: StationConnectionFactory = StationConnectionFactory { url ->
        URI(url).toURL().openConnection() as HttpURLConnection
    },
) {
    fun execute(request: AuthorizedStationRequest, credential: StationCredential): AuthorizedStationResponse {
        StationCredentialPolicy.validateTimeouts(request.connectTimeoutMs, request.readTimeoutMs)
        if (credential.raceId != request.raceId || credential.scope != StationCredentialPolicy.READOUT_SCOPE) {
            fail("Credentialen saknar rätt lopp- eller funktionsscope")
        }
        val url = StationCredentialPolicy.authorizedUrl(
            request.baseUrl,
            request.raceId,
            request.resource,
            request.method,
        )
        val bodyBytes = validateBody(request, credential.deviceId)
        val responseLimit = if (request.resource == "station-package") {
            StationCredentialLimits.MAX_PACKAGE_RESPONSE_BYTES
        } else {
            StationCredentialLimits.MAX_ACK_RESPONSE_BYTES
        }
        val connection = try {
            connectionFactory.open(url)
        } catch (failure: IOException) {
            throw StationStoreFailure(StationStoreErrors.AUTHORIZED_REQUEST, "Serveranslutningen kunde inte öppnas", failure)
        }
        try {
            connection.requestMethod = request.method
            connection.connectTimeout = request.connectTimeoutMs
            connection.readTimeout = request.readTimeoutMs
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            connection.setRequestProperty("Authorization", "Bearer ${credential.token}")
            if (bodyBytes != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("Idempotency-Key", request.idempotencyKey)
                connection.setFixedLengthStreamingMode(bodyBytes.size)
                connection.outputStream.use { it.write(bodyBytes) }
            }
            val status = connection.responseCode
            if (status !in 100..599) fail("Servern gav en ogiltig HTTP-status")
            val declaredLength = connection.getHeaderFieldLong("Content-Length", -1L)
            if (declaredLength > responseLimit) fail("Serversvaret är för stort")
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val responseBytes = stream?.use { input -> readBounded(input, responseLimit) } ?: ByteArray(0)
            val responseData = StrictUtf8.decode(
                responseBytes,
                StationStoreErrors.AUTHORIZED_REQUEST,
                "Serversvaret är inte giltig UTF-8",
            )
            if (responseData.contains(credential.token)) fail("Serversvaret innehåller otillåten credentialdata")
            val headers = linkedMapOf<String, String>()
            connection.headerFields.forEach { (name, values) ->
                val normalizedName = name?.lowercase()
                if (normalizedName in EXPOSED_RESPONSE_HEADERS && values != null) {
                    val joined = values.joinToString(",")
                    if (joined.length > MAX_RESPONSE_HEADER_VALUE_LENGTH || joined.contains(credential.token)) {
                        fail("Serversvaret innehåller otillåten headerdata")
                    }
                    headers[normalizedName!!] = joined
                }
            }
            return AuthorizedStationResponse(
                status = status,
                headers = headers,
                data = responseData,
                url = url,
            )
        } catch (failure: StationStoreFailure) {
            throw failure
        } catch (failure: IOException) {
            throw StationStoreFailure(StationStoreErrors.AUTHORIZED_REQUEST, "Den autentiserade serverförfrågan misslyckades", failure)
        } finally {
            bodyBytes?.fill(0)
            connection.disconnect()
        }
    }

    private fun validateBody(request: AuthorizedStationRequest, deviceId: String): ByteArray? {
        if (request.method == "GET") {
            if (request.bodyJson != null || request.idempotencyKey != null) fail("GET-förfrågan får inte ha body")
            return null
        }
        val bodyJson = request.bodyJson ?: fail("POST-förfrågan saknar body")
        val bytes = bodyJson.toByteArray(StandardCharsets.UTF_8)
        if (bytes.isEmpty() || bytes.size > StationCredentialLimits.MAX_REQUEST_BODY_BYTES) fail("Requestbody har ogiltig storlek")
        val root = try {
            JSONObject(bodyJson)
        } catch (failure: JSONException) {
            throw StationStoreFailure(StationStoreErrors.AUTHORIZED_REQUEST, "Requestbody är inte giltig JSON", failure)
        }
        requireExactKeys(
            root,
            setOf("deviceId", "sessionId", "packageVersion", "firstSequence", "lastSequence", "events"),
        )
        if (root.opt("deviceId") != deviceId) fail("Requestbody tillhör en annan station")
        requireUuid(root.opt("deviceId"), "deviceId")
        requireUuid(root.opt("sessionId"), "sessionId")
        requirePositiveInt(root.opt("packageVersion"), "packageVersion")
        val first = requirePositiveInt(root.opt("firstSequence"), "firstSequence")
        val last = requirePositiveInt(root.opt("lastSequence"), "lastSequence")
        if (first != last) fail("Native auth tillåter endast single-event-batcher")
        val events = root.opt("events") as? JSONArray ?: fail("events är ogiltigt")
        if (events.length() != 1) fail("Native auth tillåter endast single-event-batcher")
        val event = events.opt(0) as? JSONObject ?: fail("events[0] är ogiltigt")
        requireExactKeys(event, setOf("localSequence", "stationReceivedAt", "transport", "payload", "contentHash"))
        if (requirePositiveInt(event.opt("localSequence"), "localSequence") != first ||
            event.opt("transport") != "simulator" || event.opt("payload") !is JSONObject ||
            event.opt("stationReceivedAt") !is String ||
            (event.opt("contentHash") as? String)?.matches(SHA256_HEX) != true
        ) {
            fail("Eventet är ogiltigt")
        }
        if (request.idempotencyKey != StationCredentialPolicy.expectedIdempotencyKey(deviceId, first)) {
            fail("Idempotency-Key matchar inte single-event-batchen")
        }
        return bytes
    }

    private fun readBounded(input: java.io.InputStream, maximum: Int): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (output.size() + count > maximum) fail("Serversvaret är för stort")
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun requireExactKeys(value: JSONObject, expected: Set<String>) {
        if (value.keys().asSequence().toSet() != expected) fail("Requestbody har ogiltiga fält")
    }

    private fun requirePositiveInt(value: Any?, label: String): Int {
        val number = value as? Number ?: fail("$label är ogiltigt")
        val longValue = number.toLong()
        if (number.toDouble() != longValue.toDouble() || longValue !in 1..Int.MAX_VALUE.toLong()) fail("$label är ogiltigt")
        return longValue.toInt()
    }

    private fun requireUuid(value: Any?, label: String) {
        val text = value as? String ?: fail("$label är ogiltigt")
        try {
            if (java.util.UUID.fromString(text).toString() != text) fail("$label är ogiltigt")
        } catch (failure: IllegalArgumentException) {
            throw StationStoreFailure(StationStoreErrors.AUTHORIZED_REQUEST, "$label är ogiltigt", failure)
        }
    }

    private fun fail(message: String): Nothing =
        throw StationStoreFailure(StationStoreErrors.AUTHORIZED_REQUEST, message)

    private val SHA256_HEX = Regex("^[a-f0-9]{64}$")

    companion object {
        private const val MAX_RESPONSE_HEADER_VALUE_LENGTH = 8 * 1024
        private val EXPOSED_RESPONSE_HEADERS = setOf(
            "cache-control",
            "content-length",
            "content-type",
            "etag",
            "www-authenticate",
        )
    }
}

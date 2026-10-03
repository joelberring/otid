package se.otid.station.store

import java.net.URI
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

object StationCredentialPolicy {
    data class ParsedToken(val credentialId: String, val secret: ByteArray)

    fun validate(credential: StationCredential): StationCredential {
        if (credential.formatVersion != 1 || credential.scope != READOUT_SCOPE || credential.generation <= 0) {
            fail("Credentialmetadata är ogiltig")
        }
        requireUuid(credential.credentialId, "credentialId")
        requireUuid(credential.deviceId, "deviceId")
        requireUuid(credential.raceId, "raceId")
        val parsedToken = parseToken(credential.token)
        if (parsedToken.credentialId != credential.credentialId) fail("Credential-id matchar inte token")
        parsedToken.secret.fill(0)
        val issuedAt = parseEpochMs(credential.issuedAt, "issuedAt")
        val expiresAt = parseEpochMs(credential.expiresAt, "expiresAt")
        if (expiresAt <= issuedAt) fail("Credentialens giltighetsintervall är ogiltigt")
        return credential
    }

    fun parseToken(token: String): ParsedToken {
        if (token.length > MAX_TOKEN_LENGTH || token.any { it.isWhitespace() || it == '\r' || it == '\n' }) {
            fail("Credentialtoken är ogiltig")
        }
        val parts = token.split('.')
        if (parts.size != 3 || parts[0] != TOKEN_PREFIX) fail("Credentialtoken är ogiltig")
        val credentialId = parts[1]
        requireUuid(credentialId, "credentialId")
        val encodedSecret = parts[2]
        if (encodedSecret.length != 43 || !BASE64URL.matches(encodedSecret)) fail("Credentialtoken är ogiltig")
        val secret = try {
            Base64Url.decode(encodedSecret)
        } catch (failure: IllegalArgumentException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_CREDENTIAL, "Credentialtoken är ogiltig", failure)
        }
        if (secret.size != 32) fail("Credentialtoken är ogiltig")
        return ParsedToken(credentialId, secret)
    }

    fun isExpired(credential: StationCredential, nowEpochMs: Long): Boolean =
        nowEpochMs >= parseEpochMs(credential.expiresAt, "expiresAt")

    fun requireInstallable(
        credential: StationCredential,
        expectedDeviceId: String,
        current: StationCredential?,
        nowEpochMs: Long,
    ) {
        validate(credential)
        if (credential.deviceId != expectedDeviceId) fail("Credentialen tillhör en annan station")
        if (isExpired(credential, nowEpochMs)) fail("Credentialen har gått ut")
        if (current != null && current.deviceId == credential.deviceId && current.raceId == credential.raceId) {
            if (credential.generation < current.generation) fail("En äldre credentialgeneration får inte installeras")
            if (credential.generation == current.generation && credential != current) {
                fail("Samma credentialgeneration har annat innehåll")
            }
        }
    }

    fun authorizedUrl(baseUrl: String, raceId: String, resource: String, method: String): String {
        requireUuid(raceId, "raceId")
        val expectedMethod = when (resource) {
            "station-package" -> "GET"
            "device-batches" -> "POST"
            else -> fail("Stationsrouten är inte tillåten")
        }
        if (method != expectedMethod) fail("HTTP-metoden är inte tillåten för stationsrouten")
        val normalized = BaseUrlNormalizer.normalize(baseUrl)
        return URI(normalized).resolve("api/races/$raceId/$resource").toASCIIString()
    }

    fun validateTimeouts(connectTimeoutMs: Int, readTimeoutMs: Int) {
        if (connectTimeoutMs !in StationCredentialLimits.MIN_TIMEOUT_MS..StationCredentialLimits.MAX_CONNECT_TIMEOUT_MS ||
            readTimeoutMs !in StationCredentialLimits.MIN_TIMEOUT_MS..StationCredentialLimits.MAX_READ_TIMEOUT_MS
        ) {
            fail("HTTP-timeout är ogiltig")
        }
    }

    fun expectedIdempotencyKey(deviceId: String, localSequence: Int): String {
        requireUuid(deviceId, "deviceId")
        if (localSequence <= 0) fail("localSequence är ogiltigt")
        return "$deviceId:$localSequence:$localSequence"
    }

    internal fun parseEpochMs(value: String, label: String): Long {
        if (!ISO_UTC.matches(value)) fail("$label är ogiltigt")
        val fractionStart = value.indexOf('.')
        val normalized = if (fractionStart < 0) {
            value.dropLast(1) + ".000Z"
        } else {
            val fraction = value.substring(fractionStart + 1, value.length - 1)
            value.substring(0, fractionStart + 1) + fraction.padEnd(3, '0').take(3) + "Z"
        }
        val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT).apply {
            isLenient = false
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val position = ParsePosition(0)
        val parsed = formatter.parse(normalized, position)
        if (parsed == null || position.index != normalized.length) fail("$label är ogiltigt")
        return parsed.time
    }

    private fun requireUuid(value: String, label: String) {
        val parsed = try {
            UUID.fromString(value)
        } catch (failure: IllegalArgumentException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_CREDENTIAL, "$label är ogiltigt", failure)
        }
        if (parsed.toString() != value) fail("$label är inte en kanonisk UUID")
    }

    private fun fail(message: String): Nothing =
        throw StationStoreFailure(StationStoreErrors.INVALID_CREDENTIAL, message)

    const val READOUT_SCOPE = "READOUT"
    private const val TOKEN_PREFIX = "otid_stn_v1"
    private const val MAX_TOKEN_LENGTH = 128
    private val BASE64URL = Regex("^[A-Za-z0-9_-]{43}$")
    private val ISO_UTC = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$")
}

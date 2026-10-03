package se.otid.station.store

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

internal class StationPairingHttpClient(
    private val connectionFactory: StationConnectionFactory = StationConnectionFactory { url ->
        URI(url).toURL().openConnection() as HttpURLConnection
    },
) {
    fun redeem(
        pending: StationPairingRecord.Pending,
        connectTimeoutMs: Int,
        readTimeoutMs: Int,
    ): StationPairingServerResponse {
        StationCredentialPolicy.validateTimeouts(connectTimeoutMs, readTimeoutMs)
        StationPairingPolicy.requirePendingMatches(
            pending,
            pending.attemptId,
            pending.deviceId,
            pending.baseUrl,
        )
        val requestBytes = StationPairingCodec.requestBytes(
            StationPairingRedeemRequest(
                formatVersion = 1,
                attemptId = pending.attemptId,
                deviceId = pending.deviceId,
                credentialSecretHash = Rs256Crypto.sha256Hex(pending.credentialSecret),
            ),
        )
        val url = StationPairingPolicy.redeemUrl(pending.baseUrl)
        val connection = try {
            connectionFactory.open(url)
        } catch (failure: IOException) {
            throw requestFailure("Pairingservern kunde inte nås", failure)
        }
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.doOutput = true
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${pending.grantToken}")
            connection.setRequestProperty("Idempotency-Key", StationPairingPolicy.idempotencyKey(pending.attemptId))
            connection.setFixedLengthStreamingMode(requestBytes.size)
            connection.outputStream.use { it.write(requestBytes) }
            val status = connection.responseCode
            if (status !in 100..599) throw requestFailure("Pairingservern gav ogiltig status")
            val declaredLength = connection.getHeaderFieldLong("Content-Length", -1L)
            if (declaredLength > StationPairingLimits.MAX_RESPONSE_BYTES) {
                throw requestFailure("Pairingsvaret är för stort")
            }
            val input = if (status >= 400) connection.errorStream else connection.inputStream
            val responseBytes = input?.use { readBounded(it) } ?: ByteArray(0)
            if (status !in 200..299) throw httpFailure(status)
            return StationPairingCodec.parseServerResponse(responseBytes)
        } catch (failure: StationStoreFailure) {
            throw failure
        } catch (failure: IOException) {
            throw requestFailure("Pairingförfrågan misslyckades", failure)
        } finally {
            requestBytes.fill(0)
            connection.disconnect()
        }
    }

    private fun readBounded(input: java.io.InputStream): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(1024)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (output.size() + count > StationPairingLimits.MAX_RESPONSE_BYTES) {
                throw requestFailure("Pairingsvaret är för stort")
            }
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun httpFailure(status: Int): StationStoreFailure = when (status) {
        400 -> StationStoreFailure(StationStoreErrors.INVALID_PAIRING, "Pairingförfrågan avvisades")
        401 -> StationStoreFailure(StationStoreErrors.PAIRING_UNAUTHORIZED, "Parningsgrantet godkändes inte")
        409 -> StationStoreFailure(StationStoreErrors.PAIRING_CONFLICT, "Parningsgrantet är redan bundet till ett annat försök")
        429 -> StationStoreFailure(StationStoreErrors.PAIRING_RATE_LIMITED, "För många parningsförsök; försök senare")
        else -> requestFailure("Pairingservern svarade med HTTP $status")
    }

    private fun requestFailure(message: String, cause: Throwable? = null): StationStoreFailure =
        StationStoreFailure(StationStoreErrors.PAIRING_REQUEST, message, cause)
}

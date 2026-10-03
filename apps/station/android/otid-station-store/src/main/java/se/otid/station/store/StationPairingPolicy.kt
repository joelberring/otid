package se.otid.station.store

import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.UUID

fun interface PairingSecretSource {
    fun nextSecret(): ByteArray
}

internal class SecurePairingSecretSource : PairingSecretSource {
    private val secureRandom = SecureRandom()

    override fun nextSecret(): ByteArray = ByteArray(32).also(secureRandom::nextBytes)
}

internal object StationPairingPolicy {
    data class ParsedGrant(val grantId: String, val secret: ByteArray)

    fun parseGrant(token: String): ParsedGrant {
        if (token.isEmpty() || token.length > StationPairingLimits.MAX_GRANT_LENGTH ||
            token.any { it.isWhitespace() }
        ) {
            fail("Parningsgrantet är ogiltigt")
        }
        val parts = token.split('.')
        if (parts.size != 3 || parts[0] != GRANT_PREFIX) fail("Parningsgrantet är ogiltigt")
        requireUuid(parts[1], "grant-id")
        if (parts[2].length != 43 || !BASE64URL.matches(parts[2])) fail("Parningsgrantet är ogiltigt")
        val secret = try {
            Base64Url.decode(parts[2])
        } catch (failure: IllegalArgumentException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_PAIRING, "Parningsgrantet är ogiltigt", failure)
        }
        if (secret.size != 32) fail("Parningsgrantet är ogiltigt")
        return ParsedGrant(parts[1], secret)
    }

    fun normalizePairingUrl(baseUrl: String): String = BaseUrlNormalizer.normalize(baseUrl)

    fun redeemUrl(baseUrl: String): String = URI(normalizePairingUrl(baseUrl))
        .resolve("api/station-pairing/redeem")
        .toASCIIString()

    fun idempotencyKey(attemptId: String): String {
        requireUuid(attemptId, "attempt-id")
        return "pairing:$attemptId"
    }

    fun grantFingerprint(grantToken: String): String = Rs256Crypto.sha256Hex(
        grantToken.toByteArray(StandardCharsets.UTF_8),
    )

    fun validateGeneratedSecret(secret: ByteArray) {
        if (secret.size != 32) fail("Credential-secret måste vara exakt 32 byte")
    }

    fun requirePendingMatches(
        pending: StationPairingRecord.Pending,
        expectedAttemptId: String,
        expectedDeviceId: String,
        expectedBaseUrl: String,
    ) {
        requireUuid(expectedAttemptId, "attempt-id")
        requireUuid(expectedDeviceId, "device-id")
        if (pending.attemptId != expectedAttemptId || pending.deviceId != expectedDeviceId ||
            pending.baseUrl != normalizePairingUrl(expectedBaseUrl)
        ) {
            fail("Det beständiga parningsförsöket matchar inte stationen")
        }
        validateGeneratedSecret(pending.credentialSecret)
        val parsed = parseGrant(pending.grantToken)
        try {
            if (grantFingerprint(pending.grantToken) != pending.grantFingerprint) {
                fail("Det beständiga parningsgrantet matchar inte")
            }
        } finally {
            parsed.secret.fill(0)
        }
    }

    fun validateServerResponse(
        response: StationPairingServerResponse,
        pending: StationPairingRecord.Pending,
        nowEpochMs: Long,
    ) {
        if (response.formatVersion != 1 || response.attemptId != pending.attemptId ||
            response.credential.deviceId != pending.deviceId ||
            response.credential.scope != StationCredentialPolicy.READOUT_SCOPE
        ) {
            fail("Pairingsvaret matchar inte det beständiga försöket")
        }
        val credential = StationCredential(
            formatVersion = 1,
            token = "otid_stn_v1.${response.credential.credentialId}.${Base64Url.encode(pending.credentialSecret)}",
            credentialId = response.credential.credentialId,
            deviceId = response.credential.deviceId,
            raceId = response.credential.raceId,
            scope = response.credential.scope,
            generation = response.credential.generation,
            issuedAt = response.credential.issuedAt,
            expiresAt = response.credential.expiresAt,
        )
        StationCredentialPolicy.requireInstallable(credential, pending.deviceId, null, nowEpochMs)
    }

    fun credentialFrom(response: StationPairingServerResponse, secret: ByteArray): StationCredential {
        validateGeneratedSecret(secret)
        return StationCredential(
            formatVersion = 1,
            token = "otid_stn_v1.${response.credential.credentialId}.${Base64Url.encode(secret)}",
            credentialId = response.credential.credentialId,
            deviceId = response.credential.deviceId,
            raceId = response.credential.raceId,
            scope = response.credential.scope,
            generation = response.credential.generation,
            issuedAt = response.credential.issuedAt,
            expiresAt = response.credential.expiresAt,
        )
    }

    fun requireUuid(value: String, label: String) {
        val parsed = try {
            UUID.fromString(value)
        } catch (failure: IllegalArgumentException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_PAIRING, "$label är ogiltigt", failure)
        }
        if (parsed.toString() != value) fail("$label är inte en kanonisk UUID")
    }

    private fun fail(message: String): Nothing =
        throw StationStoreFailure(StationStoreErrors.INVALID_PAIRING, message)

    private const val GRANT_PREFIX = "otid_pair_v1"
    private val BASE64URL = Regex("^[A-Za-z0-9_-]{43}$")
}

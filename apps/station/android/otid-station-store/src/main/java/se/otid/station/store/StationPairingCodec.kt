package se.otid.station.store

import org.json.JSONException
import org.json.JSONObject
import java.nio.charset.StandardCharsets

internal object StationPairingCodec {
    fun encode(record: StationPairingRecord): ByteArray {
        val value = when (record) {
            is StationPairingRecord.Empty -> JSONObject()
                .put("formatVersion", record.formatVersion)
                .put("state", "empty")
                .put("deviceId", record.deviceId)
                .put("clearedAtEpochMs", record.clearedAtEpochMs)
            is StationPairingRecord.Pending -> JSONObject()
                .put("formatVersion", record.formatVersion)
                .put("state", "pending")
                .put("deviceId", record.deviceId)
                .put("attemptId", record.attemptId)
                .put("baseUrl", record.baseUrl)
                .put("grantToken", record.grantToken)
                .put("grantFingerprint", record.grantFingerprint)
                .put("credentialSecret", Base64Url.encode(record.credentialSecret))
                .put("startedAtEpochMs", record.startedAtEpochMs)
            is StationPairingRecord.Completed -> JSONObject()
                .put("formatVersion", record.formatVersion)
                .put("state", "completed")
                .put("deviceId", record.deviceId)
                .put("attemptId", record.attemptId)
                .put("baseUrl", record.baseUrl)
                .put("grantFingerprint", record.grantFingerprint)
                .put("credential", metadataJson(record.credential))
                .put("completedAtEpochMs", record.completedAtEpochMs)
        }
        val bytes = CanonicalJson.encode(value)
        if (bytes.isEmpty() || bytes.size > StationPairingLimits.MAX_PAIRING_PLAINTEXT_BYTES) invalid()
        return bytes
    }

    fun decode(bytes: ByteArray): StationPairingRecord {
        if (bytes.isEmpty() || bytes.size > StationPairingLimits.MAX_PAIRING_PLAINTEXT_BYTES) invalid()
        val root = try {
            JSONObject(StrictUtf8.decode(bytes, StationStoreErrors.INVALID_PAIRING, "Parningstillståndet är inte giltig UTF-8"))
        } catch (failure: JSONException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_PAIRING, "Parningstillståndet är inte giltig JSON", failure)
        }
        if (requireInt(root, "formatVersion") != 1) invalid()
        return when (requireText(root, "state", 16)) {
            "empty" -> {
                exactKeys(root, EMPTY_KEYS)
                StationPairingRecord.Empty(
                    deviceId = requireUuid(root, "deviceId"),
                    clearedAtEpochMs = requireEpoch(root, "clearedAtEpochMs"),
                )
            }
            "pending" -> {
                exactKeys(root, PENDING_KEYS)
                val secret = decodeSecret(requireText(root, "credentialSecret", 43))
                try {
                    val pending = StationPairingRecord.Pending(
                        deviceId = requireUuid(root, "deviceId"),
                        attemptId = requireUuid(root, "attemptId"),
                        baseUrl = StationPairingPolicy.normalizePairingUrl(requireText(root, "baseUrl", StationStoreLimits.MAX_BASE_URL_LENGTH)),
                        grantToken = requireText(root, "grantToken", StationPairingLimits.MAX_GRANT_LENGTH),
                        grantFingerprint = requireHash(root, "grantFingerprint"),
                        credentialSecret = secret,
                        startedAtEpochMs = requireEpoch(root, "startedAtEpochMs"),
                    )
                    StationPairingPolicy.requirePendingMatches(
                        pending,
                        pending.attemptId,
                        pending.deviceId,
                        pending.baseUrl,
                    )
                    pending
                } catch (failure: Exception) {
                    secret.fill(0)
                    throw failure
                }
            }
            "completed" -> {
                exactKeys(root, COMPLETED_KEYS)
                val deviceId = requireUuid(root, "deviceId")
                val credential = parseMetadata(root.opt("credential") as? JSONObject ?: invalid())
                if (credential.deviceId != deviceId) invalid()
                StationPairingRecord.Completed(
                    deviceId = deviceId,
                    attemptId = requireUuid(root, "attemptId"),
                    baseUrl = StationPairingPolicy.normalizePairingUrl(requireText(root, "baseUrl", StationStoreLimits.MAX_BASE_URL_LENGTH)),
                    grantFingerprint = requireHash(root, "grantFingerprint"),
                    credential = credential,
                    completedAtEpochMs = requireEpoch(root, "completedAtEpochMs"),
                )
            }
            else -> invalid()
        }
    }

    fun parseServerResponse(bytes: ByteArray): StationPairingServerResponse {
        if (bytes.isEmpty() || bytes.size > StationPairingLimits.MAX_RESPONSE_BYTES) invalidResponse()
        val root = try {
            JSONObject(StrictUtf8.decode(bytes, StationStoreErrors.PAIRING_REQUEST, "Pairingsvaret är inte giltig UTF-8"))
        } catch (failure: JSONException) {
            throw StationStoreFailure(StationStoreErrors.PAIRING_REQUEST, "Pairingsvaret är inte giltig JSON", failure)
        }
        if (root.keys().asSequence().toSet() != RESPONSE_KEYS || requireInt(root, "formatVersion") != 1) {
            invalidResponse()
        }
        return StationPairingServerResponse(
            formatVersion = 1,
            attemptId = requireUuid(root, "attemptId"),
            credential = parseMetadata(root.opt("credential") as? JSONObject ?: invalidResponse()),
        )
    }

    fun requestBytes(request: StationPairingRedeemRequest): ByteArray {
        if (request.formatVersion != 1) invalid()
        StationPairingPolicy.requireUuid(request.attemptId, "attempt-id")
        StationPairingPolicy.requireUuid(request.deviceId, "device-id")
        if (!HASH.matches(request.credentialSecretHash)) invalid()
        return CanonicalJson.encode(
            JSONObject()
                .put("formatVersion", 1)
                .put("attemptId", request.attemptId)
                .put("deviceId", request.deviceId)
                .put("credentialSecretHash", request.credentialSecretHash),
        )
    }

    private fun parseMetadata(value: JSONObject): StationCredentialMetadata {
        if (value.keys().asSequence().toSet() != METADATA_KEYS) invalidResponse()
        val metadata = StationCredentialMetadata(
            credentialId = requireUuid(value, "credentialId"),
            deviceId = requireUuid(value, "deviceId"),
            raceId = requireUuid(value, "raceId"),
            scope = requireText(value, "scope", 16),
            generation = requireInt(value, "generation"),
            issuedAt = requireText(value, "issuedAt", 64),
            expiresAt = requireText(value, "expiresAt", 64),
        )
        val dummySecret = Base64Url.encode(ByteArray(32))
        StationCredentialPolicy.validate(
            StationCredential(
                formatVersion = 1,
                token = "otid_stn_v1.${metadata.credentialId}.$dummySecret",
                credentialId = metadata.credentialId,
                deviceId = metadata.deviceId,
                raceId = metadata.raceId,
                scope = metadata.scope,
                generation = metadata.generation,
                issuedAt = metadata.issuedAt,
                expiresAt = metadata.expiresAt,
            ),
        )
        return metadata
    }

    private fun metadataJson(metadata: StationCredentialMetadata): JSONObject = JSONObject()
        .put("credentialId", metadata.credentialId)
        .put("deviceId", metadata.deviceId)
        .put("raceId", metadata.raceId)
        .put("scope", metadata.scope)
        .put("generation", metadata.generation)
        .put("issuedAt", metadata.issuedAt)
        .put("expiresAt", metadata.expiresAt)

    private fun decodeSecret(value: String): ByteArray {
        val bytes = try {
            Base64Url.decode(value)
        } catch (failure: IllegalArgumentException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_PAIRING, "Credential-secret är ogiltig", failure)
        }
        if (bytes.size != 32) invalid()
        return bytes
    }

    private fun exactKeys(value: JSONObject, expected: Set<String>) {
        if (value.keys().asSequence().toSet() != expected) invalid()
    }

    private fun requireText(value: JSONObject, key: String, maxLength: Int): String {
        val text = value.opt(key) as? String ?: invalid()
        if (text.isEmpty() || text.length > maxLength || text.trim() != text) invalid()
        return text
    }

    private fun requireUuid(value: JSONObject, key: String): String = requireText(value, key, 36).also {
        StationPairingPolicy.requireUuid(it, key)
    }

    private fun requireHash(value: JSONObject, key: String): String = requireText(value, key, 64).also {
        if (!HASH.matches(it)) invalid()
    }

    private fun requireInt(value: JSONObject, key: String): Int {
        val number = value.opt(key) as? Number ?: invalid()
        val longValue = number.toLong()
        if (number.toDouble() != longValue.toDouble() || longValue !in 1..Int.MAX_VALUE.toLong()) invalid()
        return longValue.toInt()
    }

    private fun requireEpoch(value: JSONObject, key: String): Long {
        val number = value.opt(key) as? Number ?: invalid()
        val longValue = number.toLong()
        if (number.toDouble() != longValue.toDouble() || longValue < 0) invalid()
        return longValue
    }

    private fun invalid(): Nothing =
        throw StationStoreFailure(StationStoreErrors.INVALID_PAIRING, "Parningstillståndet är ogiltigt")

    private fun invalidResponse(): Nothing =
        throw StationStoreFailure(StationStoreErrors.PAIRING_REQUEST, "Pairingsvaret är ogiltigt")

    private val EMPTY_KEYS = setOf("formatVersion", "state", "deviceId", "clearedAtEpochMs")
    private val PENDING_KEYS = setOf(
        "formatVersion", "state", "deviceId", "attemptId", "baseUrl", "grantToken",
        "grantFingerprint", "credentialSecret", "startedAtEpochMs",
    )
    private val COMPLETED_KEYS = setOf(
        "formatVersion", "state", "deviceId", "attemptId", "baseUrl", "grantFingerprint",
        "credential", "completedAtEpochMs",
    )
    private val RESPONSE_KEYS = setOf("formatVersion", "attemptId", "credential")
    private val METADATA_KEYS = setOf(
        "credentialId", "deviceId", "raceId", "scope", "generation", "issuedAt", "expiresAt",
    )
    private val HASH = Regex("^[a-f0-9]{64}$")
}

package se.otid.station.store

import org.json.JSONException
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.UUID

object LocalEvaluationParser {
    fun parse(localEvaluationJson: String, evaluationHash: String): LocalEvaluationRecord {
        if (localEvaluationJson.isEmpty() ||
            localEvaluationJson.length > StationStoreLimits.MAX_LOCAL_EVALUATION_LENGTH
        ) {
            fail(StationStoreErrors.INVALID_ARGUMENT, "localEvaluationJson har ogiltig storlek")
        }
        requireHash(evaluationHash, "evaluationHash")
        val bytes = localEvaluationJson.toByteArray(StandardCharsets.UTF_8)
        if (Rs256Crypto.sha256Hex(bytes) != evaluationHash) {
            fail(StationStoreErrors.HASH_MISMATCH, "evaluationHash matchar inte localEvaluationJson")
        }
        val value = try {
            JSONObject(localEvaluationJson)
        } catch (failure: JSONException) {
            throw StationStoreFailure(
                StationStoreErrors.INVALID_ARGUMENT,
                "localEvaluationJson är inte giltig JSON",
                failure,
            )
        }
        val expectedKeys = setOf(
            "formatVersion",
            "deviceId",
            "localSequence",
            "raceId",
            "packageVersion",
            "packagePayloadSha256",
            "engineVersion",
            "snapshotVersion",
            "evaluation",
        )
        if (value.keys().asSequence().toSet() != expectedKeys) {
            fail(StationStoreErrors.INVALID_ARGUMENT, "localEvaluationJson har ogiltiga fält")
        }
        val canonicalBytes = try {
            CanonicalJson.encode(value)
        } catch (failure: StationStoreFailure) {
            throw StationStoreFailure(
                StationStoreErrors.INVALID_ARGUMENT,
                "localEvaluationJson är inte canonical JSON",
                failure,
            )
        }
        if (!Rs256Crypto.equal(canonicalBytes, bytes)) {
            fail(StationStoreErrors.INVALID_ARGUMENT, "localEvaluationJson är inte canonical JSON")
        }
        if (requirePositiveInt(value, "formatVersion") != 1) {
            fail(StationStoreErrors.INVALID_ARGUMENT, "formatVersion stöds inte")
        }
        val deviceId = requireUuid(value, "deviceId")
        val localSequence = requirePositiveInt(value, "localSequence")
        val raceId = requireUuid(value, "raceId")
        val packageVersion = requirePositiveInt(value, "packageVersion")
        val packagePayloadSha256 = requireHash(value.opt("packagePayloadSha256"), "packagePayloadSha256")
        val engineVersion = value.opt("engineVersion") as? String
            ?: fail(StationStoreErrors.INVALID_ARGUMENT, "engineVersion är ogiltigt")
        if (engineVersion.isBlank() || engineVersion.length > 64) {
            fail(StationStoreErrors.INVALID_ARGUMENT, "engineVersion är ogiltigt")
        }
        val snapshotVersion = requirePositiveInt(value, "snapshotVersion")
        if (value.opt("evaluation") !is JSONObject) {
            fail(StationStoreErrors.INVALID_ARGUMENT, "evaluation är ogiltigt")
        }
        return LocalEvaluationRecord(
            deviceId = deviceId,
            localSequence = localSequence,
            raceId = raceId,
            packageVersion = packageVersion,
            packagePayloadSha256 = packagePayloadSha256,
            engineVersion = engineVersion,
            snapshotVersion = snapshotVersion,
            localEvaluationJson = localEvaluationJson,
            evaluationHash = evaluationHash,
        )
    }

    private fun requirePositiveInt(value: JSONObject, key: String): Int {
        val number = value.opt(key) as? Number
            ?: fail(StationStoreErrors.INVALID_ARGUMENT, "$key är ogiltigt")
        val longValue = number.toLong()
        if (number.toDouble() != longValue.toDouble() || longValue !in 1..Int.MAX_VALUE.toLong()) {
            fail(StationStoreErrors.INVALID_ARGUMENT, "$key är ogiltigt")
        }
        return longValue.toInt()
    }

    private fun requireUuid(value: JSONObject, key: String): String {
        val text = value.opt(key) as? String
            ?: fail(StationStoreErrors.INVALID_ARGUMENT, "$key är ogiltigt")
        val uuid = try {
            UUID.fromString(text)
        } catch (failure: IllegalArgumentException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_ARGUMENT, "$key är ogiltigt", failure)
        }
        if (uuid.toString() != text) fail(StationStoreErrors.INVALID_ARGUMENT, "$key är inte en kanonisk UUID")
        return text
    }

    private fun requireHash(value: Any?, key: String): String {
        val hash = value as? String ?: fail(StationStoreErrors.INVALID_ARGUMENT, "$key är ogiltigt")
        if (!SHA256_HEX.matches(hash)) fail(StationStoreErrors.INVALID_ARGUMENT, "$key är ogiltigt")
        return hash
    }

    private fun fail(code: String, message: String): Nothing = throw StationStoreFailure(code, message)

    private val SHA256_HEX = Regex("^[a-f0-9]{64}$")
}

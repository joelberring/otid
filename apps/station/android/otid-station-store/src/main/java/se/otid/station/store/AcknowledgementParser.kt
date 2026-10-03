package se.otid.station.store

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.UUID

object AcknowledgementParser {
    fun parse(acknowledgementJson: String): ParsedAcknowledgement {
        if (acknowledgementJson.isEmpty() || acknowledgementJson.length > StationStoreLimits.MAX_ACKNOWLEDGEMENT_LENGTH) {
            fail("Kvittensen har ogiltig storlek")
        }
        val root = try {
            JSONObject(acknowledgementJson)
        } catch (failure: JSONException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_ARGUMENT, "Kvittensen är inte giltig JSON", failure)
        }
        requireExactKeys(
            root,
            setOf(
                "deviceId",
                "highestContiguousSequence",
                "currentPackageVersion",
                "packageVersionStatus",
                "packageUpdateRequired",
                "acknowledgements",
            ),
        )
        val deviceId = requireUuid(root, "deviceId")
        if (requireInt(root, "highestContiguousSequence", 0) < 0) fail("highestContiguousSequence är ogiltigt")
        val currentPackageVersion = requireInt(root, "currentPackageVersion", 1)
        val packageStatus = requireText(root, "packageVersionStatus", 16)
        if (packageStatus !in setOf("current", "stale", "ahead")) fail("packageVersionStatus är ogiltigt")
        val updateRequired = root.opt("packageUpdateRequired") as? Boolean
            ?: fail("packageUpdateRequired är ogiltigt")
        if (updateRequired != (packageStatus == "stale")) fail("Paketstatus och uppdateringskrav motsäger varandra")

        val acknowledgements = root.opt("acknowledgements") as? JSONArray
            ?: fail("acknowledgements är ogiltigt")
        if (acknowledgements.length() !in 1..StationStoreLimits.MAX_PENDING_LIMIT) {
            fail("acknowledgements har ogiltig storlek")
        }
        val commands = ArrayList<AcknowledgementCommand>(acknowledgements.length())
        var previousSequence = 0
        repeat(acknowledgements.length()) { index ->
            val acknowledgement = acknowledgements.opt(index) as? JSONObject
                ?: fail("acknowledgements[$index] är ogiltigt")
            val status = requireText(acknowledgement, "status", 16)
            val command = when (status) {
                "stored", "duplicate" -> parseAcknowledged(
                    acknowledgement,
                    status,
                    currentPackageVersion,
                    packageStatus,
                    updateRequired,
                )
                "rejected" -> parseRejected(
                    acknowledgement,
                    currentPackageVersion,
                    packageStatus,
                    updateRequired,
                )
                else -> fail("acknowledgements[$index].status är ogiltigt")
            }
            if (command.localSequence <= previousSequence) {
                fail("Kvittenssekvenserna måste vara unika och stigande")
            }
            previousSequence = command.localSequence
            commands += command
        }
        return ParsedAcknowledgement(deviceId, acknowledgementJson, commands)
    }

    private fun parseAcknowledged(
        value: JSONObject,
        status: String,
        currentPackageVersion: Int,
        packageVersionStatus: String,
        packageUpdateRequired: Boolean,
    ): AcknowledgementCommand {
        val keys = value.keys().asSequence().toSet()
        val required = setOf("localSequence", "contentHash", "status", "rawMessageId")
        if (keys != required && keys != required + "serverResult") fail("En positiv kvittens har ogiltiga fält")
        val serverResult = if (value.has("serverResult")) {
            parseServerResult(value.opt("serverResult") as? JSONObject ?: fail("serverResult är ogiltigt"))
        } else {
            null
        }
        val eventJson = canonical(value, "Kvittensposten").first
        return AcknowledgementCommand(
            localSequence = requireInt(value, "localSequence", 1),
            contentHash = requireHash(value, "contentHash"),
            status = status,
            rawMessageId = requireUuid(value, "rawMessageId"),
            rejectionReason = null,
            currentPackageVersion = currentPackageVersion,
            packageVersionStatus = packageVersionStatus,
            packageUpdateRequired = packageUpdateRequired,
            eventAcknowledgementJson = eventJson,
            observationHash = observationHash(
                value,
                currentPackageVersion,
                packageVersionStatus,
                packageUpdateRequired,
            ),
            serverResult = serverResult,
        )
    }

    private fun parseRejected(
        value: JSONObject,
        currentPackageVersion: Int,
        packageVersionStatus: String,
        packageUpdateRequired: Boolean,
    ): AcknowledgementCommand {
        requireExactKeys(value, setOf("localSequence", "contentHash", "status", "reason"))
        val reason = requireText(value, "reason", 64)
        if (reason !in REJECTION_REASONS) fail("Avvisningsorsaken är ogiltig")
        val eventJson = canonical(value, "Kvittensposten").first
        return AcknowledgementCommand(
            localSequence = requireInt(value, "localSequence", 1),
            contentHash = requireHash(value, "contentHash"),
            status = "rejected",
            rawMessageId = null,
            rejectionReason = reason,
            currentPackageVersion = currentPackageVersion,
            packageVersionStatus = packageVersionStatus,
            packageUpdateRequired = packageUpdateRequired,
            eventAcknowledgementJson = eventJson,
            observationHash = observationHash(
                value,
                currentPackageVersion,
                packageVersionStatus,
                packageUpdateRequired,
            ),
            serverResult = null,
        )
    }

    private fun observationHash(
        acknowledgement: JSONObject,
        currentPackageVersion: Int,
        packageVersionStatus: String,
        packageUpdateRequired: Boolean,
    ): String = canonical(
        JSONObject()
            .put("currentPackageVersion", currentPackageVersion)
            .put("packageVersionStatus", packageVersionStatus)
            .put("packageUpdateRequired", packageUpdateRequired)
            .put("acknowledgement", acknowledgement),
        "Serverobservationen",
    ).second

    private fun parseServerResult(value: JSONObject): ParsedServerResult {
        val status = requireText(value, "status", 32)
        val reason = requireText(value, "reason", 64)
        val versionKeys = setOf("status", "reason", "engineVersion", "snapshotVersion", "evaluationHash")
        when (status) {
            "UNKNOWN_CARD" -> {
                requireExactKeys(value, versionKeys)
                if (reason != "UNKNOWN_CARD") fail("serverResult har motsägande status och orsak")
            }
            "OK" -> {
                requireExactKeys(value, versionKeys + PERSISTED_RESULT_KEYS)
                if (reason != "COMPLETE") fail("serverResult har motsägande status och orsak")
                requirePersistedResult(value)
            }
            "MP" -> {
                requireExactKeys(value, versionKeys + PERSISTED_RESULT_KEYS)
                if (reason !in MP_REASONS) fail("serverResult.reason är ogiltig")
                requirePersistedResult(value)
            }
            else -> fail("serverResult.status är ogiltig")
        }
        requireText(value, "engineVersion", 64)
        requireInt(value, "snapshotVersion", 1)
        val evaluationHash = requireHash(value, "evaluationHash")
        val canonical = canonical(value, "serverResult")
        return ParsedServerResult(
            serverResultJson = canonical.first,
            serverResultHash = canonical.second,
            evaluationHash = evaluationHash,
        )
    }

    private fun requirePersistedResult(value: JSONObject) {
        requireUuid(value, "resultRevisionId")
        requireInt(value, "revision", 1)
        requireUuid(value, "courseVersionId")
    }

    private fun canonical(value: JSONObject, label: String): Pair<String, String> {
        val bytes = try {
            CanonicalJson.encode(value)
        } catch (failure: StationStoreFailure) {
            throw StationStoreFailure(StationStoreErrors.INVALID_ARGUMENT, "$label är inte canonicaliserbar", failure)
        }
        return String(bytes, StandardCharsets.UTF_8) to Rs256Crypto.sha256Hex(bytes)
    }

    private fun requireExactKeys(value: JSONObject, expected: Set<String>) {
        if (value.keys().asSequence().toSet() != expected) fail("Kvittensen har ogiltiga fält")
    }

    private fun requireText(value: JSONObject, key: String, maxLength: Int): String {
        val text = value.opt(key) as? String ?: fail("$key är ogiltigt")
        if (text.isEmpty() || text.length > maxLength) fail("$key är ogiltigt")
        return text
    }

    private fun requireInt(value: JSONObject, key: String, minimum: Int): Int {
        val number = value.opt(key) as? Number ?: fail("$key är ogiltigt")
        val longValue = number.toLong()
        if (number.toDouble() != longValue.toDouble() || longValue !in minimum.toLong()..Int.MAX_VALUE.toLong()) {
            fail("$key är ogiltigt")
        }
        return longValue.toInt()
    }

    private fun requireUuid(value: JSONObject, key: String): String {
        val text = requireText(value, key, 36)
        val parsed = try {
            UUID.fromString(text)
        } catch (failure: IllegalArgumentException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_ARGUMENT, "$key är ogiltigt", failure)
        }
        if (parsed.toString() != text) fail("$key är inte en kanonisk UUID")
        return text
    }

    private fun requireHash(value: JSONObject, key: String): String {
        val hash = requireText(value, key, 64)
        if (!SHA256_HEX.matches(hash)) fail("$key är ogiltigt")
        return hash
    }

    private fun fail(message: String): Nothing =
        throw StationStoreFailure(StationStoreErrors.INVALID_ARGUMENT, message)

    private val SHA256_HEX = Regex("^[a-f0-9]{64}$")
    private val REJECTION_REASONS = setOf(
        "CONTENT_HASH_MISMATCH",
        "SEQUENCE_HASH_CONFLICT",
        "SEQUENCE_CONTEXT_CONFLICT",
    )
    private val PERSISTED_RESULT_KEYS = setOf("resultRevisionId", "revision", "courseVersionId")
    private val MP_REASONS = setOf(
        "MISSING_START",
        "MISSING_FINISH",
        "MISSING_CONTROL",
        "WRONG_ORDER",
        "INVALID_TIME_ORDER",
    )
}

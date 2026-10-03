package se.otid.station.store

import android.util.Base64
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.util.UUID

object SignedPackageVerifier {
    fun verify(envelopeJson: String, trustedPublicKeySpkiBase64: String): VerifiedCompetitionPackage {
        if (envelopeJson.isEmpty() || envelopeJson.length > StationStoreLimits.MAX_ENVELOPE_LENGTH) {
            fail(StationStoreErrors.INVALID_ENVELOPE, "Paketkuvertet har ogiltig storlek")
        }
        val envelope = parseObject(envelopeJson, StationStoreErrors.INVALID_ENVELOPE, "Paketkuvertet är inte giltig JSON")
        requireExactKeys(
            envelope,
            setOf("formatVersion", "algorithm", "keyId", "payload", "signature"),
            StationStoreErrors.INVALID_ENVELOPE,
            "Paketkuvertet har ogiltiga fält",
        )
        if (requireInt(envelope, "formatVersion", StationStoreErrors.INVALID_ENVELOPE) != 1 ||
            requireString(envelope, "algorithm", 16, StationStoreErrors.INVALID_ENVELOPE) != "RS256"
        ) {
            fail(StationStoreErrors.INVALID_ENVELOPE, "Paketkuvertets format eller algoritm stöds inte")
        }

        val trustedSpki = decodeCanonicalStandardBase64(trustedPublicKeySpkiBase64)
        val trustedKey = Rs256Crypto.parseTrustedPublicKey(trustedSpki)
        val trustedKeyId = Rs256Crypto.keyId(trustedSpki)
        val envelopeKeyId = requireHash(envelope, "keyId", StationStoreErrors.INVALID_ENVELOPE)
        if (envelopeKeyId != trustedKeyId) {
            fail(StationStoreErrors.UNTRUSTED_KEY, "Paketets key-id matchar inte den betrodda nyckeln")
        }

        val payloadBytes = decodeCanonicalBase64Url(
            requireString(
                envelope,
                "payload",
                StationStoreLimits.MAX_ENVELOPE_PAYLOAD_LENGTH,
                StationStoreErrors.INVALID_ENVELOPE,
            ),
            StationStoreErrors.INVALID_ENVELOPE,
            "Paketets payload är inte kanonisk Base64URL",
        )
        val signatureBytes = decodeCanonicalBase64Url(
            requireString(envelope, "signature", 16 * 1024, StationStoreErrors.INVALID_ENVELOPE),
            StationStoreErrors.INVALID_ENVELOPE,
            "Paketets signatur är inte kanonisk Base64URL",
        )
        if (!Rs256Crypto.verify(payloadBytes, signatureBytes, trustedKey)) {
            fail(StationStoreErrors.INVALID_SIGNATURE, "Paketets signatur är ogiltig")
        }

        val payloadText = StrictUtf8.decode(
            payloadBytes,
            StationStoreErrors.INVALID_PACKAGE,
            "Paketpayloaden är inte giltig UTF-8",
        )
        val payload = parseObject(payloadText, StationStoreErrors.INVALID_PACKAGE, "Paketpayloaden är inte giltig JSON")
        if (!Rs256Crypto.equal(CanonicalJson.encode(payload), payloadBytes)) {
            fail(StationStoreErrors.INVALID_PACKAGE, "Paketpayloaden är inte canonical JSON")
        }
        requireExactKeys(
            payload,
            setOf(
                "formatVersion",
                "raceId",
                "packageVersion",
                "resultEngineVersion",
                "stationFunction",
                "event",
                "raceSnapshot",
                "verificationKey",
            ),
            StationStoreErrors.INVALID_PACKAGE,
            "Paketpayloaden har ogiltiga fält",
        )
        if (requireInt(payload, "formatVersion", StationStoreErrors.INVALID_PACKAGE) != 1) {
            fail(StationStoreErrors.INVALID_PACKAGE, "Paketpayloadens format stöds inte")
        }
        val raceId = requireUuid(payload, "raceId", StationStoreErrors.INVALID_PACKAGE)
        val packageVersion = requirePositiveInt(payload, "packageVersion", StationStoreErrors.INVALID_PACKAGE)
        requireNonBlank(payload, "resultEngineVersion", StationStoreErrors.INVALID_PACKAGE, 64)
        if (requireString(payload, "stationFunction", 32, StationStoreErrors.INVALID_PACKAGE) != "READOUT") {
            fail(StationStoreErrors.INVALID_PACKAGE, "Stationsfunktionen stöds inte")
        }
        val eventId = validateEvent(payload)
        validateRaceSnapshot(payload, raceId, packageVersion, eventId)
        validateVerificationKey(payload, trustedSpki, trustedKeyId)

        return VerifiedCompetitionPackage(
            raceId = raceId,
            packageVersion = packageVersion,
            payloadSha256 = Rs256Crypto.sha256Hex(payloadBytes),
            keyId = trustedKeyId,
            envelopeJson = envelopeJson,
            payloadBytes = payloadBytes.copyOf(),
        )
    }

    private fun validateEvent(payload: JSONObject): String {
        val event = requireObject(payload, "event", StationStoreErrors.INVALID_PACKAGE)
        requireExactKeys(
            event,
            setOf("id", "name", "startsOn", "timeZone"),
            StationStoreErrors.INVALID_PACKAGE,
            "Paketets event har ogiltiga fält",
        )
        val eventId = requireUuid(event, "id", StationStoreErrors.INVALID_PACKAGE)
        requireNonBlank(event, "name", StationStoreErrors.INVALID_PACKAGE, 160)
        requireNonBlank(event, "startsOn", StationStoreErrors.INVALID_PACKAGE, 10)
        requireNonBlank(event, "timeZone", StationStoreErrors.INVALID_PACKAGE, 128)
        return eventId
    }

    private fun validateRaceSnapshot(payload: JSONObject, raceId: String, packageVersion: Int, eventId: String) {
        val snapshot = requireObject(payload, "raceSnapshot", StationStoreErrors.INVALID_PACKAGE)
        requireExactKeys(
            snapshot,
            setOf("race", "classes", "courses", "entries", "cardAssignments"),
            StationStoreErrors.INVALID_PACKAGE,
            "Paketets raceSnapshot har ogiltiga fält",
        )
        listOf("classes", "courses", "entries", "cardAssignments").forEach { key ->
            if (snapshot.opt(key) !is JSONArray) {
                fail(StationStoreErrors.INVALID_PACKAGE, "Paketets raceSnapshot.$key är ogiltigt")
            }
        }
        val race = requireObject(snapshot, "race", StationStoreErrors.INVALID_PACKAGE)
        requireExactKeys(
            race,
            setOf("id", "eventId", "name", "raceDate", "snapshotVersion"),
            StationStoreErrors.INVALID_PACKAGE,
            "Paketets raceSnapshot.race har ogiltiga fält",
        )
        val snapshotRaceId = requireUuid(race, "id", StationStoreErrors.INVALID_PACKAGE)
        val snapshotEventId = requireUuid(race, "eventId", StationStoreErrors.INVALID_PACKAGE)
        requireNonBlank(race, "name", StationStoreErrors.INVALID_PACKAGE, 160)
        requireNonBlank(race, "raceDate", StationStoreErrors.INVALID_PACKAGE, 10)
        val snapshotVersion = requirePositiveInt(race, "snapshotVersion", StationStoreErrors.INVALID_PACKAGE)
        if (snapshotRaceId != raceId || snapshotVersion != packageVersion || snapshotEventId != eventId) {
            fail(StationStoreErrors.INVALID_PACKAGE, "Paketversionen matchar inte raceSnapshot")
        }
    }

    private fun validateVerificationKey(payload: JSONObject, trustedSpki: ByteArray, trustedKeyId: String) {
        val verificationKey = requireObject(payload, "verificationKey", StationStoreErrors.INVALID_PACKAGE)
        requireExactKeys(
            verificationKey,
            setOf("algorithm", "keyId", "publicKeySpkiBase64"),
            StationStoreErrors.INVALID_PACKAGE,
            "Paketets verificationKey har ogiltiga fält",
        )
        if (requireString(verificationKey, "algorithm", 16, StationStoreErrors.INVALID_PACKAGE) != "RS256" ||
            requireHash(verificationKey, "keyId", StationStoreErrors.INVALID_PACKAGE) != trustedKeyId
        ) {
            fail(StationStoreErrors.UNTRUSTED_KEY, "Paketpayloadens verifieringsnyckel matchar inte bootstrapnyckeln")
        }
        val embeddedSpki = try {
            decodeCanonicalStandardBase64(
                requireString(
                    verificationKey,
                    "publicKeySpkiBase64",
                    16 * 1024,
                    StationStoreErrors.INVALID_PACKAGE,
                ),
            )
        } catch (failure: StationStoreFailure) {
            if (failure.code == StationStoreErrors.UNTRUSTED_KEY) throw failure
            throw StationStoreFailure(
                StationStoreErrors.UNTRUSTED_KEY,
                "Paketpayloadens verifieringsnyckel är ogiltig",
                failure,
            )
        }
        if (!Rs256Crypto.equal(embeddedSpki, trustedSpki)) {
            fail(StationStoreErrors.UNTRUSTED_KEY, "Paketpayloadens verifieringsnyckel matchar inte bootstrapnyckeln")
        }
    }

    private fun decodeCanonicalStandardBase64(value: String): ByteArray {
        if (value.isEmpty() || !STANDARD_BASE64.matches(value)) {
            fail(StationStoreErrors.UNTRUSTED_KEY, "Den betrodda verifieringsnyckeln är inte kanonisk Base64")
        }
        val decoded = try {
            Base64.decode(value, Base64.NO_WRAP)
        } catch (failure: IllegalArgumentException) {
            throw StationStoreFailure(
                StationStoreErrors.UNTRUSTED_KEY,
                "Den betrodda verifieringsnyckeln är inte kanonisk Base64",
                failure,
            )
        }
        if (Base64.encodeToString(decoded, Base64.NO_WRAP) != value) {
            fail(StationStoreErrors.UNTRUSTED_KEY, "Den betrodda verifieringsnyckeln är inte kanonisk Base64")
        }
        return decoded
    }

    private fun decodeCanonicalBase64Url(value: String, code: String, message: String): ByteArray {
        if (value.isEmpty() || !BASE64_URL.matches(value)) fail(code, message)
        val decoded = try {
            Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        } catch (failure: IllegalArgumentException) {
            throw StationStoreFailure(code, message, failure)
        }
        if (Base64.encodeToString(decoded, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) != value) {
            fail(code, message)
        }
        return decoded
    }

    private fun parseObject(value: String, code: String, message: String): JSONObject = try {
        JSONObject(value)
    } catch (failure: JSONException) {
        throw StationStoreFailure(code, message, failure)
    }

    private fun requireExactKeys(value: JSONObject, expected: Set<String>, code: String, message: String) {
        if (value.keys().asSequence().toSet() != expected) fail(code, message)
    }

    private fun requireObject(value: JSONObject, key: String, code: String): JSONObject =
        value.opt(key) as? JSONObject ?: fail(code, "$key är ogiltigt")

    private fun requireString(value: JSONObject, key: String, maxLength: Int, code: String): String {
        val text = value.opt(key) as? String ?: fail(code, "$key är ogiltigt")
        if (text.isEmpty() || text.length > maxLength) fail(code, "$key är ogiltigt")
        return text
    }

    private fun requireNonBlank(
        value: JSONObject,
        key: String,
        code: String,
        maxLength: Int = StationStoreLimits.MAX_TEXT_LENGTH,
    ): String {
        val text = requireString(value, key, maxLength, code)
        if (text.isBlank()) fail(code, "$key är ogiltigt")
        return text
    }

    private fun requireInt(value: JSONObject, key: String, code: String): Int {
        val number = value.opt(key) as? Number ?: fail(code, "$key är ogiltigt")
        val longValue = number.toLong()
        if (number.toDouble() != longValue.toDouble() || longValue !in Int.MIN_VALUE..Int.MAX_VALUE) {
            fail(code, "$key är ogiltigt")
        }
        return longValue.toInt()
    }

    private fun requirePositiveInt(value: JSONObject, key: String, code: String): Int {
        val number = requireInt(value, key, code)
        if (number <= 0) fail(code, "$key är ogiltigt")
        return number
    }

    private fun requireUuid(value: JSONObject, key: String, code: String): String {
        val text = requireString(value, key, 36, code)
        val parsed = try {
            UUID.fromString(text)
        } catch (failure: IllegalArgumentException) {
            throw StationStoreFailure(code, "$key är ogiltigt", failure)
        }
        if (parsed.toString() != text) fail(code, "$key är inte en kanonisk UUID")
        return text
    }

    private fun requireHash(value: JSONObject, key: String, code: String): String {
        val hash = requireString(value, key, 64, code)
        if (!SHA256_HEX.matches(hash)) fail(code, "$key är ogiltigt")
        return hash
    }

    private fun fail(code: String, message: String): Nothing = throw StationStoreFailure(code, message)

    private val SHA256_HEX = Regex("^[a-f0-9]{64}$")
    private val BASE64_URL = Regex("^[A-Za-z0-9_-]+$")
    private val STANDARD_BASE64 = Regex("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")
}

package se.otid.station.store

import org.json.JSONException
import org.json.JSONObject
import java.nio.charset.StandardCharsets

object StationCredentialParser {
    private val credentialKeys = setOf(
        "formatVersion",
        "token",
        "credentialId",
        "deviceId",
        "raceId",
        "scope",
        "generation",
        "issuedAt",
        "expiresAt",
    )

    fun parse(json: String): StationCredential {
        val bytes = json.toByteArray(StandardCharsets.UTF_8)
        if (bytes.isEmpty() || bytes.size > StationCredentialLimits.MAX_CREDENTIAL_JSON_BYTES) fail("Credentialen har ogiltig storlek")
        val value = try {
            JSONObject(json)
        } catch (failure: JSONException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_CREDENTIAL, "Credentialen är inte giltig JSON", failure)
        }
        if (value.keys().asSequence().toSet() != credentialKeys) fail("Credentialen har ogiltiga fält")
        val credential = StationCredential(
            formatVersion = requireInt(value, "formatVersion"),
            token = requireText(value, "token", 128),
            credentialId = requireText(value, "credentialId", 36),
            deviceId = requireText(value, "deviceId", 36),
            raceId = requireText(value, "raceId", 36),
            scope = requireText(value, "scope", 16),
            generation = requireInt(value, "generation"),
            issuedAt = requireText(value, "issuedAt", 64),
            expiresAt = requireText(value, "expiresAt", 64),
        )
        return StationCredentialPolicy.validate(credential)
    }

    fun encode(credential: StationCredential): ByteArray = CanonicalJson.encode(
        JSONObject()
            .put("formatVersion", credential.formatVersion)
            .put("token", credential.token)
            .put("credentialId", credential.credentialId)
            .put("deviceId", credential.deviceId)
            .put("raceId", credential.raceId)
            .put("scope", credential.scope)
            .put("generation", credential.generation)
            .put("issuedAt", credential.issuedAt)
            .put("expiresAt", credential.expiresAt),
    )

    private fun requireText(value: JSONObject, key: String, maxLength: Int): String {
        val text = value.opt(key) as? String ?: fail("$key är ogiltigt")
        if (text.isEmpty() || text.length > maxLength) fail("$key är ogiltigt")
        return text
    }

    private fun requireInt(value: JSONObject, key: String): Int {
        val number = value.opt(key) as? Number ?: fail("$key är ogiltigt")
        val longValue = number.toLong()
        if (number.toDouble() != longValue.toDouble() || longValue !in 1..Int.MAX_VALUE.toLong()) fail("$key är ogiltigt")
        return longValue.toInt()
    }

    private fun fail(message: String): Nothing =
        throw StationStoreFailure(StationStoreErrors.INVALID_CREDENTIAL, message)
}

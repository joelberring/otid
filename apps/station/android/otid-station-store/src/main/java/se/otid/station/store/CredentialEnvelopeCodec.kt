package se.otid.station.store

import org.json.JSONException
import org.json.JSONObject

object CredentialEnvelopeCodec {
    fun encode(encrypted: EncryptedCredential): ByteArray = CanonicalJson.encode(
        JSONObject()
            .put("formatVersion", 1)
            .put("initializationVector", Base64Url.encode(encrypted.initializationVector))
            .put("ciphertext", Base64Url.encode(encrypted.ciphertext)),
    )

    fun decode(bytes: ByteArray): EncryptedCredential {
        if (bytes.isEmpty() || bytes.size > StationCredentialLimits.MAX_ENCRYPTED_ENVELOPE_BYTES) invalid()
        val value = try {
            JSONObject(StrictUtf8.decode(bytes, StationStoreErrors.CREDENTIAL_STORAGE, "Credentialkuvertet är inte giltig UTF-8"))
        } catch (failure: JSONException) {
            throw StationStoreFailure(StationStoreErrors.CREDENTIAL_STORAGE, "Credentialkuvertet är inte giltig JSON", failure)
        }
        if (value.keys().asSequence().toSet() != setOf("formatVersion", "initializationVector", "ciphertext") ||
            value.opt("formatVersion") != 1
        ) {
            invalid()
        }
        val iv = decodeBase64(value.opt("initializationVector") as? String ?: invalid())
        val ciphertext = decodeBase64(value.opt("ciphertext") as? String ?: invalid())
        if (iv.size != 12 || ciphertext.size !in 17..StationCredentialLimits.MAX_CREDENTIAL_JSON_BYTES + 16) invalid()
        return EncryptedCredential(iv, ciphertext)
    }

    private fun decodeBase64(value: String): ByteArray {
        if (value.isEmpty() || value.any { it == '=' || it.isWhitespace() }) invalid()
        return try {
            Base64Url.decode(value)
        } catch (failure: IllegalArgumentException) {
            throw StationStoreFailure(StationStoreErrors.CREDENTIAL_STORAGE, "Credentialkuvertet är ogiltigt", failure)
        }
    }

    private fun invalid(): Nothing =
        throw StationStoreFailure(StationStoreErrors.CREDENTIAL_STORAGE, "Credentialkuvertet är ogiltigt")
}

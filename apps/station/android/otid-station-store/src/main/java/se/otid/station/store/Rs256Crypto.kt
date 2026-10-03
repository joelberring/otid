package se.otid.station.store

import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PublicKey
import java.security.Signature
import java.security.interfaces.RSAPublicKey
import java.security.spec.X509EncodedKeySpec

object Rs256Crypto {
    fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

    fun sha256Hex(bytes: ByteArray): String = sha256(bytes).joinToString("") { byte ->
        "%02x".format(byte.toInt() and 0xff)
    }

    fun keyId(spkiDer: ByteArray): String = sha256Hex(spkiDer)

    fun parseTrustedPublicKey(spkiDer: ByteArray): PublicKey {
        val key = try {
            KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(spkiDer))
        } catch (failure: Exception) {
            throw StationStoreFailure(
                StationStoreErrors.UNTRUSTED_KEY,
                "Den betrodda verifieringsnyckeln är ogiltig",
                failure,
            )
        }
        val rsaKey = key as? RSAPublicKey
            ?: throw StationStoreFailure(
                StationStoreErrors.UNTRUSTED_KEY,
                "Den betrodda verifieringsnyckeln är inte RSA",
            )
        if (rsaKey.modulus.bitLength() < MINIMUM_RSA_BITS) {
            throw StationStoreFailure(
                StationStoreErrors.UNTRUSTED_KEY,
                "Den betrodda verifieringsnyckeln är för kort",
            )
        }
        return rsaKey
    }

    fun verify(payloadBytes: ByteArray, signatureBytes: ByteArray, trustedKey: PublicKey): Boolean {
        val verifier = Signature.getInstance("SHA256withRSA")
        verifier.initVerify(trustedKey)
        verifier.update(payloadBytes)
        return try {
            verifier.verify(signatureBytes)
        } catch (_: java.security.SignatureException) {
            false
        }
    }

    fun equal(left: ByteArray, right: ByteArray): Boolean = MessageDigest.isEqual(left, right)

    private const val MINIMUM_RSA_BITS = 2048
}

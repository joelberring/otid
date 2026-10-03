package se.otid.station.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature

class Rs256CryptoTest {
    @Test
    fun `RS256 verifies exact bytes and rejects tampering`() {
        val keyPair = rsaKeyPair(2048)
        val payload = "{\"formatVersion\":1}".toByteArray()
        val signature = Signature.getInstance("SHA256withRSA").run {
            initSign(keyPair.private)
            update(payload)
            sign()
        }
        val trusted = Rs256Crypto.parseTrustedPublicKey(keyPair.public.encoded)

        assertTrue(Rs256Crypto.verify(payload, signature, trusted))
        assertFalse(Rs256Crypto.verify(payload + byteArrayOf(0x20), signature, trusted))
    }

    @Test
    fun `key id is lowercase SHA-256 of exact SPKI DER`() {
        val spki = rsaKeyPair(2048).public.encoded

        val keyId = Rs256Crypto.keyId(spki)

        assertTrue(keyId.matches(Regex("^[a-f0-9]{64}$")))
        assertEquals(Rs256Crypto.sha256Hex(spki), keyId)
    }

    @Test
    fun `short RSA bootstrap key is rejected with stable code`() {
        val failure = assertThrows(StationStoreFailure::class.java) {
            Rs256Crypto.parseTrustedPublicKey(rsaKeyPair(1024).public.encoded)
        }

        assertEquals(StationStoreErrors.UNTRUSTED_KEY, failure.code)
    }

    private fun rsaKeyPair(bits: Int) = KeyPairGenerator.getInstance("RSA").apply {
        initialize(bits)
    }.generateKeyPair()
}

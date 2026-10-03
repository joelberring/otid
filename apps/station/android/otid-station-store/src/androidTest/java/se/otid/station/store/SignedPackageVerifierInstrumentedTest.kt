package se.otid.station.store

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature

@RunWith(AndroidJUnit4::class)
class SignedPackageVerifierInstrumentedTest {
    @Test
    fun exactSignedPayloadIsVerifiedAndReturnedByteIdentically() {
        val keyPair = rsaKeyPair()
        val signed = signedPackage(keyPair)

        val verified = SignedPackageVerifier.verify(signed.envelopeJson, signed.spkiBase64)

        assertArrayEquals(signed.payloadBytes, verified.payloadBytes)
        assertEquals(RACE_ID, verified.raceId)
        assertEquals(7, verified.packageVersion)
        assertEquals(Rs256Crypto.keyId(keyPair.public.encoded), verified.keyId)
    }

    @Test
    fun payloadSignatureEnvelopeKeyAndBootstrapTamperingAreRejected() {
        val keyPair = rsaKeyPair()
        val signed = signedPackage(keyPair)
        val envelope = JSONObject(signed.envelopeJson)

        val payloadFailure = assertThrows(StationStoreFailure::class.java) {
            val changedPayload = signed.payloadBytes + byteArrayOf(0x20)
            SignedPackageVerifier.verify(
                JSONObject(signed.envelopeJson).put("payload", base64Url(changedPayload)).toString(),
                signed.spkiBase64,
            )
        }
        assertEquals(StationStoreErrors.INVALID_SIGNATURE, payloadFailure.code)

        val changedSignature = decodeBase64Url(envelope.getString("signature")).apply {
            this[lastIndex] = (this[lastIndex].toInt() xor 1).toByte()
        }
        val signatureFailure = assertThrows(StationStoreFailure::class.java) {
            SignedPackageVerifier.verify(
                JSONObject(signed.envelopeJson).put("signature", base64Url(changedSignature)).toString(),
                signed.spkiBase64,
            )
        }
        assertEquals(StationStoreErrors.INVALID_SIGNATURE, signatureFailure.code)

        val keyIdFailure = assertThrows(StationStoreFailure::class.java) {
            SignedPackageVerifier.verify(
                JSONObject(signed.envelopeJson).put("keyId", "b".repeat(64)).toString(),
                signed.spkiBase64,
            )
        }
        assertEquals(StationStoreErrors.UNTRUSTED_KEY, keyIdFailure.code)

        val otherSpki = Base64.encodeToString(rsaKeyPair().public.encoded, Base64.NO_WRAP)
        val bootstrapFailure = assertThrows(StationStoreFailure::class.java) {
            SignedPackageVerifier.verify(signed.envelopeJson, otherSpki)
        }
        assertEquals(StationStoreErrors.UNTRUSTED_KEY, bootstrapFailure.code)
    }

    @Test
    fun signedPayloadCannotReplaceEmbeddedBootstrapKeyOrSnapshotVersion() {
        val signingKey = rsaKeyPair()
        val otherSpki = Base64.encodeToString(rsaKeyPair().public.encoded, Base64.NO_WRAP)
        val embeddedMismatch = signedPackage(signingKey, embeddedSpkiBase64 = otherSpki)
        val keyFailure = assertThrows(StationStoreFailure::class.java) {
            SignedPackageVerifier.verify(embeddedMismatch.envelopeJson, embeddedMismatch.spkiBase64)
        }
        assertEquals(StationStoreErrors.UNTRUSTED_KEY, keyFailure.code)

        val versionMismatch = signedPackage(signingKey, snapshotVersion = 6)
        val packageFailure = assertThrows(StationStoreFailure::class.java) {
            SignedPackageVerifier.verify(versionMismatch.envelopeJson, versionMismatch.spkiBase64)
        }
        assertEquals(StationStoreErrors.INVALID_PACKAGE, packageFailure.code)

        val eventMismatch = signedPackage(signingKey, payloadEventId = OTHER_EVENT_ID)
        val eventFailure = assertThrows(StationStoreFailure::class.java) {
            SignedPackageVerifier.verify(eventMismatch.envelopeJson, eventMismatch.spkiBase64)
        }
        assertEquals(StationStoreErrors.INVALID_PACKAGE, eventFailure.code)
    }

    @Test
    fun signedButNonCanonicalPayloadIsRejected() {
        val keyPair = rsaKeyPair()
        val canonical = signedPackage(keyPair)
        val payloadObject = JSONObject(String(canonical.payloadBytes, Charsets.UTF_8))
        val nonCanonicalBytes = payloadObject.toString(2).toByteArray(Charsets.UTF_8)
        val signature = Signature.getInstance("SHA256withRSA").run {
            initSign(keyPair.private)
            update(nonCanonicalBytes)
            sign()
        }
        val envelope = JSONObject(canonical.envelopeJson)
            .put("payload", base64Url(nonCanonicalBytes))
            .put("signature", base64Url(signature))

        val failure = assertThrows(StationStoreFailure::class.java) {
            SignedPackageVerifier.verify(envelope.toString(), canonical.spkiBase64)
        }

        assertEquals(StationStoreErrors.INVALID_PACKAGE, failure.code)
    }

    private fun signedPackage(
        keyPair: KeyPair,
        embeddedSpkiBase64: String = Base64.encodeToString(keyPair.public.encoded, Base64.NO_WRAP),
        snapshotVersion: Int = 7,
        payloadEventId: String = EVENT_ID,
    ): SignedFixture {
        val spkiBase64 = Base64.encodeToString(keyPair.public.encoded, Base64.NO_WRAP)
        val keyId = Rs256Crypto.keyId(keyPair.public.encoded)
        val race = JSONObject()
            .put("id", RACE_ID)
            .put("eventId", EVENT_ID)
            .put("name", "Testlopp")
            .put("raceDate", "2026-08-31")
            .put("snapshotVersion", snapshotVersion)
        val snapshot = JSONObject()
            .put("race", race)
            .put("classes", JSONArray())
            .put("courses", JSONArray())
            .put("entries", JSONArray())
            .put("cardAssignments", JSONArray())
        val payload = JSONObject()
            .put("formatVersion", 1)
            .put("raceId", RACE_ID)
            .put("packageVersion", 7)
            .put("resultEngineVersion", "0.1.0")
            .put("stationFunction", "READOUT")
            .put(
                "event",
                JSONObject()
                    .put("id", payloadEventId)
                    .put("name", "Testevent")
                    .put("startsOn", "2026-08-31")
                    .put("timeZone", "Europe/Stockholm"),
            )
            .put("raceSnapshot", snapshot)
            .put(
                "verificationKey",
                JSONObject()
                    .put("algorithm", "RS256")
                    .put("keyId", keyId)
                    .put("publicKeySpkiBase64", embeddedSpkiBase64),
            )
        val payloadBytes = CanonicalJson.encode(payload)
        val signature = Signature.getInstance("SHA256withRSA").run {
            initSign(keyPair.private)
            update(payloadBytes)
            sign()
        }
        val envelope = JSONObject()
            .put("formatVersion", 1)
            .put("algorithm", "RS256")
            .put("keyId", keyId)
            .put("payload", base64Url(payloadBytes))
            .put("signature", base64Url(signature))
        return SignedFixture(envelope.toString(), payloadBytes, spkiBase64)
    }

    private fun rsaKeyPair(): KeyPair = KeyPairGenerator.getInstance("RSA").apply {
        initialize(2048)
    }.generateKeyPair()

    private fun base64Url(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    private fun decodeBase64Url(value: String): ByteArray =
        Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    private data class SignedFixture(
        val envelopeJson: String,
        val payloadBytes: ByteArray,
        val spkiBase64: String,
    )

    companion object {
        private const val RACE_ID = "11111111-1111-4111-8111-111111111111"
        private const val EVENT_ID = "33333333-3333-4333-8333-333333333333"
        private const val OTHER_EVENT_ID = "44444444-4444-4444-8444-444444444444"
    }
}

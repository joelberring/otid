package se.otid.station.store

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class StationPairingPolicyTest {
    @Test
    fun parsesOnlyCanonicalVersionedGrantWithExactlyThirtyTwoSecretBytes() {
        val secret = ByteArray(32) { it.toByte() }
        val grant = "otid_pair_v1.$GRANT_ID.${Base64Url.encode(secret)}"
        val parsed = StationPairingPolicy.parseGrant(grant)
        assertEquals(GRANT_ID, parsed.grantId)
        assertArrayEquals(secret, parsed.secret)

        listOf(
            "otid_pair_v2.$GRANT_ID.${Base64Url.encode(secret)}",
            "otid_pair_v1.${GRANT_ID.uppercase()}.${Base64Url.encode(secret)}",
            "otid_pair_v1.$GRANT_ID.${Base64Url.encode(ByteArray(31))}",
            "$grant\n",
            "Bearer $grant",
        ).forEach { invalid ->
            val failure = assertThrows(StationStoreFailure::class.java) {
                StationPairingPolicy.parseGrant(invalid)
            }
            assertEquals(StationStoreErrors.INVALID_PAIRING, failure.code)
        }
    }

    @Test
    fun routeAndIdempotencyAreGlobalExactAndHttpsBounded() {
        assertEquals(
            "https://example.test/otid/api/station-pairing/redeem",
            StationPairingPolicy.redeemUrl("https://example.test/otid"),
        )
        assertEquals(
            "http://localhost:3000/api/station-pairing/redeem",
            StationPairingPolicy.redeemUrl("http://localhost:3000"),
        )
        assertEquals("pairing:$ATTEMPT_ID", StationPairingPolicy.idempotencyKey(ATTEMPT_ID))
        assertThrows(StationStoreFailure::class.java) {
            StationPairingPolicy.redeemUrl("http://example.test")
        }
        assertThrows(StationStoreFailure::class.java) {
            StationPairingPolicy.idempotencyKey(ATTEMPT_ID.uppercase())
        }
    }

    @Test
    fun pendingStateIsBoundToAttemptDeviceBaseUrlGrantAndSecretLength() {
        val pending = pending()
        StationPairingPolicy.requirePendingMatches(pending, ATTEMPT_ID, DEVICE_ID, "HTTPS://Example.Test:443/otid")
        listOf(
            { StationPairingPolicy.requirePendingMatches(pending, OTHER_ATTEMPT_ID, DEVICE_ID, pending.baseUrl) },
            { StationPairingPolicy.requirePendingMatches(pending, ATTEMPT_ID, OTHER_DEVICE_ID, pending.baseUrl) },
            { StationPairingPolicy.requirePendingMatches(pending, ATTEMPT_ID, DEVICE_ID, "https://other.test/") },
            { StationPairingPolicy.validateGeneratedSecret(ByteArray(31)) },
        ).forEach { operation -> assertThrows(StationStoreFailure::class.java) { operation() } }
    }

    @Test
    fun responseMustMatchPersistedAttemptDeviceAndReadoutScope() {
        val pending = pending()
        val response = response()
        StationPairingPolicy.validateServerResponse(response, pending, NOW_EPOCH_MS)
        val credential = StationPairingPolicy.credentialFrom(response, pending.credentialSecret)
        assertEquals(CREDENTIAL_ID, credential.credentialId)
        assertEquals(
            "otid_stn_v1.$CREDENTIAL_ID.${Base64Url.encode(pending.credentialSecret)}",
            credential.token,
        )

        listOf(
            response.copy(attemptId = OTHER_ATTEMPT_ID),
            response.copy(credential = response.credential.copy(deviceId = OTHER_DEVICE_ID)),
            response.copy(credential = response.credential.copy(scope = "ADMIN")),
            response.copy(credential = response.credential.copy(expiresAt = "2026-08-31T11:00:00.000Z")),
        ).forEach { invalid ->
            assertThrows(StationStoreFailure::class.java) {
                StationPairingPolicy.validateServerResponse(invalid, pending, NOW_EPOCH_MS)
            }
        }
    }

    private fun pending(): StationPairingRecord.Pending {
        val grant = "otid_pair_v1.$GRANT_ID.${Base64Url.encode(ByteArray(32) { (it + 1).toByte() })}"
        return StationPairingRecord.Pending(
            deviceId = DEVICE_ID,
            attemptId = ATTEMPT_ID,
            baseUrl = "https://example.test/otid/",
            grantToken = grant,
            grantFingerprint = StationPairingPolicy.grantFingerprint(grant),
            credentialSecret = ByteArray(32) { (it + 2).toByte() },
            startedAtEpochMs = NOW_EPOCH_MS,
        )
    }

    private fun response() = StationPairingServerResponse(
        formatVersion = 1,
        attemptId = ATTEMPT_ID,
        credential = StationCredentialMetadata(
            credentialId = CREDENTIAL_ID,
            deviceId = DEVICE_ID,
            raceId = RACE_ID,
            scope = "READOUT",
            generation = 1,
            issuedAt = "2026-08-31T10:00:00.000Z",
            expiresAt = "2026-09-01T10:00:00.000Z",
        ),
    )

    companion object {
        private const val GRANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        private const val ATTEMPT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        private const val OTHER_ATTEMPT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        private const val CREDENTIAL_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        private const val DEVICE_ID = "55555555-5555-4555-8555-555555555555"
        private const val OTHER_DEVICE_ID = "66666666-6666-4666-8666-666666666666"
        private const val RACE_ID = "11111111-1111-4111-8111-111111111111"
        private const val NOW_EPOCH_MS = 1_788_174_000_000L
    }
}

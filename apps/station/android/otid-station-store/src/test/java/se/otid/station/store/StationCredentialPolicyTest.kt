package se.otid.station.store

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class StationCredentialPolicyTest {
    @Test
    fun base64UrlCodecIsCanonicalAndRoundTripsBoundaryLengths() {
        (0..65).forEach { size ->
            val bytes = ByteArray(size) { index -> (index * 37).toByte() }
            assertArrayEquals(bytes, Base64Url.decode(Base64Url.encode(bytes)))
        }
        listOf("A", "AA=", "AA+", "AB").forEach { value ->
            assertThrows(IllegalArgumentException::class.java) { Base64Url.decode(value) }
        }
    }

    @Test
    fun acceptsStrictCredentialAndExtractsOnlyThePublicId() {
        val credential = credential()
        assertEquals(credential, StationCredentialPolicy.validate(credential))
        val parsed = StationCredentialPolicy.parseToken(credential.token)
        assertEquals(CREDENTIAL_ID, parsed.credentialId)
        assertArrayEquals(ByteArray(32) { it.toByte() }, parsed.secret)
    }

    @Test
    fun rejectsMalformedTokensMetadataAndTimestamps() {
        val invalid = listOf(
            credential().copy(formatVersion = 2),
            credential().copy(scope = "ADMIN"),
            credential().copy(generation = 0),
            credential().copy(credentialId = CREDENTIAL_ID.uppercase()),
            credential().copy(token = "otid_stn_v1.$OTHER_CREDENTIAL_ID.${Base64Url.encode(ByteArray(32))}"),
            credential().copy(token = "otid_stn_v1.$CREDENTIAL_ID.${Base64Url.encode(ByteArray(31))}"),
            credential().copy(token = credential().token + "\n"),
            credential().copy(issuedAt = "2026-08-31 10:00:00Z"),
            credential().copy(issuedAt = "2026-02-30T10:00:00.000Z"),
            credential().copy(expiresAt = "2026-08-31T10:00:00.000Z"),
        )
        invalid.forEach { value ->
            val failure = assertThrows(StationStoreFailure::class.java) {
                StationCredentialPolicy.validate(value)
            }
            assertEquals(StationStoreErrors.INVALID_CREDENTIAL, failure.code)
        }
    }

    @Test
    fun installPolicyBindsDeviceExpiryAndMonotonicGeneration() {
        val current = credential(generation = 2)
        StationCredentialPolicy.requireInstallable(current, DEVICE_ID, null, NOW_EPOCH_MS)
        StationCredentialPolicy.requireInstallable(current, DEVICE_ID, current, NOW_EPOCH_MS)

        listOf(
            credential().copy(deviceId = OTHER_DEVICE_ID),
            credential(generation = 1),
            credential(generation = 2).copy(expiresAt = "2026-08-31T11:00:00.000Z"),
        ).forEach { candidate ->
            val previous = if (candidate.generation == 1 || candidate.expiresAt.endsWith("11:00:00.000Z")) current else null
            val failure = assertThrows(StationStoreFailure::class.java) {
                StationCredentialPolicy.requireInstallable(candidate, DEVICE_ID, previous, NOW_EPOCH_MS)
            }
            assertEquals(StationStoreErrors.INVALID_CREDENTIAL, failure.code)
        }

        val equivocation = current.copy(expiresAt = "2026-09-02T10:00:00.000Z")
        assertThrows(StationStoreFailure::class.java) {
            StationCredentialPolicy.requireInstallable(equivocation, DEVICE_ID, current, NOW_EPOCH_MS)
        }
        StationCredentialPolicy.requireInstallable(credential(generation = 3), DEVICE_ID, current, NOW_EPOCH_MS)
    }

    @Test
    fun requestPolicyAllowsOnlyTwoExactScopedRoutesAndBoundedTimeouts() {
        assertEquals(
            "https://example.test/otid/api/races/$RACE_ID/station-package",
            StationCredentialPolicy.authorizedUrl("https://example.test/otid", RACE_ID, "station-package", "GET"),
        )
        assertEquals(
            "http://localhost:3000/api/races/$RACE_ID/device-batches",
            StationCredentialPolicy.authorizedUrl("http://localhost:3000", RACE_ID, "device-batches", "POST"),
        )
        StationCredentialPolicy.validateTimeouts(1_000, 60_000)
        assertEquals("$DEVICE_ID:7:7", StationCredentialPolicy.expectedIdempotencyKey(DEVICE_ID, 7))

        listOf(
            { StationCredentialPolicy.authorizedUrl("https://example.test", RACE_ID, "station-package", "POST") },
            { StationCredentialPolicy.authorizedUrl("https://example.test", RACE_ID, "device-batches", "GET") },
            { StationCredentialPolicy.authorizedUrl("https://example.test", RACE_ID, "other", "GET") },
            { StationCredentialPolicy.authorizedUrl("http://example.test", RACE_ID, "device-batches", "POST") },
            { StationCredentialPolicy.validateTimeouts(999, 60_000) },
            { StationCredentialPolicy.validateTimeouts(1_000, 60_001) },
        ).forEach { operation ->
            assertThrows(StationStoreFailure::class.java) { operation() }
        }
    }

    private fun credential(generation: Int = 2): StationCredential = StationCredential(
        formatVersion = 1,
        token = "otid_stn_v1.$CREDENTIAL_ID.${Base64Url.encode(ByteArray(32) { it.toByte() })}",
        credentialId = CREDENTIAL_ID,
        deviceId = DEVICE_ID,
        raceId = RACE_ID,
        scope = StationCredentialPolicy.READOUT_SCOPE,
        generation = generation,
        issuedAt = "2026-08-31T10:00:00.000Z",
        expiresAt = "2026-09-01T10:00:00.000Z",
    )

    companion object {
        private const val CREDENTIAL_ID = "33333333-3333-4333-8333-33333333333a"
        private const val OTHER_CREDENTIAL_ID = "44444444-4444-4444-8444-444444444444"
        private const val DEVICE_ID = "55555555-5555-4555-8555-555555555555"
        private const val OTHER_DEVICE_ID = "66666666-6666-4666-8666-666666666666"
        private const val RACE_ID = "11111111-1111-4111-8111-111111111111"
        private const val NOW_EPOCH_MS = 1_788_174_000_000L // 2026-08-31T11:00:00Z
    }
}

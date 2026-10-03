package se.otid.station.store

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class StationPairingInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val files = mutableListOf<File>()
    private val aliases = mutableListOf<String>()
    private val databases = mutableListOf<String>()

    @After
    fun clearTestState() {
        files.forEach { file ->
            file.delete()
            File(file.path + ".bak").delete()
            File(file.path + ".new").delete()
        }
        KeyStore.getInstance("AndroidKeyStore").apply {
            load(null)
            aliases.forEach { alias -> if (containsAlias(alias)) deleteEntry(alias) }
        }
        databases.forEach(context::deleteDatabase)
    }

    @Test
    fun beginPersistsEncryptedPendingBeforeAnyNetworkAndSurvivesReopen() {
        val fixture = fixture()
        var openedConnections = 0
        val coordinator = coordinator(fixture) {
            openedConnections += 1
            FakeConnection(500, "{}")
        }

        val status = coordinator.begin(BASE_URL, GRANT_TOKEN, DEVICE_ID) as StationPairingStatus.Pending
        val raw = fixture.pairingStore.read()
        val rawText = String(raw, StandardCharsets.UTF_8)

        assertEquals(ATTEMPT_ID, status.attempt.attemptId)
        assertEquals(0, openedConnections)
        assertEquals(context.noBackupFilesDir.canonicalFile, fixture.pairingStore.file.parentFile!!.canonicalFile)
        assertFalse(rawText.contains(GRANT_TOKEN))
        assertFalse(rawText.contains(Base64Url.encode(CREDENTIAL_SECRET)))
        assertFalse(rawText.contains(DEVICE_ID))
        val reopened = fixture.pairingVault().status(DEVICE_ID) as StationPairingStatus.Pending
        assertEquals(status.attempt, reopened.attempt)

        val exactRetry = fixture.pairingVault().begin(BASE_URL, GRANT_TOKEN, DEVICE_ID)
        assertEquals(status, exactRetry)
        val conflict = assertThrows(StationStoreFailure::class.java) {
            fixture.pairingVault().begin(BASE_URL, otherGrant(), DEVICE_ID)
        }
        assertEquals(StationStoreErrors.PAIRING_CONFLICT, conflict.code)
    }

    @Test
    fun lostResponseRetriesExactAttemptThenPromotesAndCompletedReplayIsNetworkFree() {
        val fixture = fixture()
        val connections = ArrayDeque<FakeConnection>()
        val lost = FakeConnection(201, responseJson(), failResponseRead = true)
        val replay = FakeConnection(200, responseJson())
        connections += lost
        connections += replay
        var opens = 0
        val coordinator = coordinator(fixture) {
            opens += 1
            connections.removeFirst()
        }
        val pending = coordinator.begin(BASE_URL, GRANT_TOKEN, DEVICE_ID) as StationPairingStatus.Pending

        val lostFailure = assertThrows(StationStoreFailure::class.java) {
            coordinator.redeem(pending.attempt.attemptId, DEVICE_ID, BASE_URL, 1_000, 2_000)
        }
        assertEquals(StationStoreErrors.PAIRING_REQUEST, lostFailure.code)
        assertTrue(fixture.pairingVault().status(DEVICE_ID) is StationPairingStatus.Pending)

        val installed = coordinator.redeem(pending.attempt.attemptId, DEVICE_ID, BASE_URL, 1_000, 2_000)
        assertEquals("installed", installed.status)
        assertEquals(CREDENTIAL_ID, installed.credential.credentialId)
        assertEquals(lost.requestBody.toString(StandardCharsets.UTF_8.name()), replay.requestBody.toString(StandardCharsets.UTF_8.name()))
        assertRequest(replay)
        assertTrue(fixture.pairingVault().status(DEVICE_ID) is StationPairingStatus.Completed)
        assertEquals(CREDENTIAL_ID, (fixture.credentialVault.status(DEVICE_ID) as StationCredentialStatus.Active).credential.credentialId)

        val completedReplay = coordinator.redeem(pending.attempt.attemptId, DEVICE_ID, BASE_URL, 1_000, 2_000)
        assertEquals("already-installed", completedReplay.status)
        assertEquals(2, opens)
        val completedRaw = String(fixture.pairingStore.read(), StandardCharsets.UTF_8)
        assertFalse(completedRaw.contains(GRANT_TOKEN))
        assertFalse(completedRaw.contains(Base64Url.encode(CREDENTIAL_SECRET)))
    }

    @Test
    fun completedMarkerFailureLeavesPendingAndInstalledCredentialRecoverableByReplay() {
        var failPairingWrite = false
        val fixture = fixture(
            pairingHooks = CredentialFileHooks(
                beforeFinishWrite = StationStoreFailureHook {
                    if (failPairingWrite) throw StationStoreFailure(StationStoreErrors.CREDENTIAL_STORAGE, "injected")
                },
            ),
        )
        val responses = ArrayDeque<FakeConnection>()
        responses += FakeConnection(201, responseJson())
        responses += FakeConnection(200, responseJson())
        val coordinator = coordinator(fixture) { responses.removeFirst() }
        val pending = coordinator.begin(BASE_URL, GRANT_TOKEN, DEVICE_ID) as StationPairingStatus.Pending

        failPairingWrite = true
        assertThrows(StationStoreFailure::class.java) {
            coordinator.redeem(pending.attempt.attemptId, DEVICE_ID, BASE_URL, 1_000, 2_000)
        }
        assertTrue(fixture.credentialVault.status(DEVICE_ID) is StationCredentialStatus.Active)
        assertTrue(fixture.pairingVault().status(DEVICE_ID) is StationPairingStatus.Pending)

        failPairingWrite = false
        val recovered = coordinator.redeem(pending.attempt.attemptId, DEVICE_ID, BASE_URL, 1_000, 2_000)
        assertEquals("installed", recovered.status)
        assertTrue(fixture.pairingVault().status(DEVICE_ID) is StationPairingStatus.Completed)
    }

    @Test
    fun authFailureTamperAndExplicitDiscardsNeverChangeSQLiteOutboxOrOldCredential() {
        val databaseName = databaseName()
        val store = StationStore(StationStoreDatabase(context, databaseName))
        store.installPackage(testPackage())
        val event = store.enqueueEvent(enqueueRequest())
        val fixture = fixture(deviceId = event.deviceId)
        fixture.credentialVault.install(oldCredential(event.deviceId), event.deviceId)
        val coordinator = coordinator(fixture) { FakeConnection(401, "{\"error\":\"unauthorized\"}") }
        val pending = coordinator.begin(BASE_URL, GRANT_TOKEN, event.deviceId) as StationPairingStatus.Pending

        val unauthorized = assertThrows(StationStoreFailure::class.java) {
            coordinator.redeem(pending.attempt.attemptId, event.deviceId, BASE_URL, 1_000, 2_000)
        }
        assertEquals(StationStoreErrors.PAIRING_UNAUTHORIZED, unauthorized.code)
        assertEquals(1, store.getStatus().pendingCount)
        assertEquals(1, (fixture.credentialVault.status(event.deviceId) as StationCredentialStatus.Active).credential.generation)
        assertTrue(fixture.pairingVault().status(event.deviceId) is StationPairingStatus.Pending)

        val wrongDiscard = assertThrows(StationStoreFailure::class.java) {
            coordinator.discard(OTHER_ATTEMPT_ID, event.deviceId)
        }
        assertEquals(StationStoreErrors.PAIRING_CONFLICT, wrongDiscard.code)
        assertEquals(StationPairingStatus.None, coordinator.discard(pending.attempt.attemptId, event.deviceId))

        coordinator.begin(BASE_URL, otherGrant(), event.deviceId)
        fixture.pairingStore.file.writeText("tampered", Charsets.UTF_8)
        assertEquals(StationPairingStatus.Invalid, fixture.pairingVault().status(event.deviceId))
        assertThrows(StationStoreFailure::class.java) {
            coordinator.discardInvalid(DEVICE_ID, event.deviceId)
        }
        assertEquals(StationPairingStatus.None, coordinator.discardInvalid(event.deviceId, event.deviceId))
        assertEquals(1, store.getStatus().pendingCount)
        assertEquals(event.contentHash, store.listPending(10).single().contentHash)
        assertEquals(1, (fixture.credentialVault.status(event.deviceId) as StationCredentialStatus.Active).credential.generation)
        store.close()
    }

    private fun fixture(
        deviceId: String = DEVICE_ID,
        pairingHooks: CredentialFileHooks = CredentialFileHooks(),
    ): Fixture {
        val suffix = UUID.randomUUID().toString()
        val keyAlias = "se.otid.station.pairing.test.$suffix"
        val cipher = AndroidKeystoreCredentialCipher(keyAlias)
        val pairingStore = AtomicCredentialFileStore(context, "station-pairing-$suffix", pairingHooks)
        val credentialStore = AtomicCredentialFileStore(context, "station-credential-$suffix")
        files += pairingStore.file
        files += credentialStore.file
        aliases += keyAlias
        return Fixture(keyAlias, cipher, pairingStore, credentialStore, deviceId)
    }

    private fun coordinator(fixture: Fixture, connection: (String) -> FakeConnection): StationPairingCoordinator =
        StationPairingCoordinator(
            fixture.pairingVault(),
            fixture.credentialVault,
            StationPairingHttpClient(StationConnectionFactory { url ->
                connection(url).also { it.requestedUrl = url }
            }),
            nowEpochMs = { NOW_EPOCH_MS },
        )

    private fun assertRequest(connection: FakeConnection) {
        assertEquals("https://example.test/otid/api/station-pairing/redeem", connection.requestedUrl)
        assertEquals("Bearer $GRANT_TOKEN", connection.getRequestProperty("Authorization"))
        assertEquals("pairing:$ATTEMPT_ID", connection.getRequestProperty("Idempotency-Key"))
        val body = JSONObject(connection.requestBody.toString(StandardCharsets.UTF_8.name()))
        assertEquals(
            setOf("formatVersion", "attemptId", "deviceId", "credentialSecretHash"),
            body.keys().asSequence().toSet(),
        )
        assertEquals(1, body.getInt("formatVersion"))
        assertEquals(ATTEMPT_ID, body.getString("attemptId"))
        assertEquals(DEVICE_ID, body.getString("deviceId"))
        assertEquals(Rs256Crypto.sha256Hex(CREDENTIAL_SECRET), body.getString("credentialSecretHash"))
        assertFalse(connection.requestBody.toString(StandardCharsets.UTF_8.name()).contains(GRANT_TOKEN))
        assertFalse(connection.requestBody.toString(StandardCharsets.UTF_8.name()).contains(Base64Url.encode(CREDENTIAL_SECRET)))
    }

    private fun responseJson(deviceId: String = DEVICE_ID): String = JSONObject()
        .put("formatVersion", 1)
        .put("attemptId", ATTEMPT_ID)
        .put(
            "credential",
            JSONObject()
                .put("credentialId", CREDENTIAL_ID)
                .put("deviceId", deviceId)
                .put("raceId", RACE_ID)
                .put("scope", "READOUT")
                .put("generation", 2)
                .put("issuedAt", "2026-08-31T10:00:00.000Z")
                .put("expiresAt", "2026-09-01T10:00:00.000Z"),
        )
        .toString()

    private fun oldCredential(deviceId: String): StationCredential {
        val secret = Base64Url.encode(ByteArray(32) { (it + 9).toByte() })
        return StationCredential(
            formatVersion = 1,
            token = "otid_stn_v1.$OLD_CREDENTIAL_ID.$secret",
            credentialId = OLD_CREDENTIAL_ID,
            deviceId = deviceId,
            raceId = RACE_ID,
            scope = "READOUT",
            generation = 1,
            issuedAt = "2026-08-31T09:00:00.000Z",
            expiresAt = "2026-09-01T09:00:00.000Z",
        )
    }

    private fun otherGrant(): String =
        "otid_pair_v1.$OTHER_GRANT_ID.${Base64Url.encode(ByteArray(32) { (it + 7).toByte() })}"

    private fun testPackage(): VerifiedCompetitionPackage {
        val bytes = CanonicalJson.encode(JSONObject().put("resultEngineVersion", "0.1.0"))
        return VerifiedCompetitionPackage(
            raceId = RACE_ID,
            packageVersion = 1,
            payloadSha256 = Rs256Crypto.sha256Hex(bytes),
            keyId = "a".repeat(64),
            envelopeJson = "{\"test\":true}",
            payloadBytes = bytes,
        )
    }

    private fun enqueueRequest(): EnqueueRequest {
        val payload = JSONObject()
            .put("cardNumber", "100")
            .put("finishPunchedAt", "2026-08-31T12:00:00.000Z")
            .put("punches", JSONArray())
            .toString()
        return EnqueueRequest(
            raceId = RACE_ID,
            sessionId = SESSION_ID,
            packageVersion = 1,
            stationReceivedAt = "2026-08-31T12:00:01.000Z",
            transport = "simulator",
            payloadJson = payload,
            contentHash = Rs256Crypto.sha256Hex(payload.toByteArray(StandardCharsets.UTF_8)),
        )
    }

    private fun databaseName(): String = "otid-station-pairing-${UUID.randomUUID()}.db".also(databases::add)

    private data class Fixture(
        val keyAlias: String,
        val cipher: AndroidKeystoreCredentialCipher,
        val pairingStore: AtomicCredentialFileStore,
        val credentialStore: AtomicCredentialFileStore,
        val deviceId: String,
    ) {
        val credentialVault = StationCredentialVault(
            packageName = "se.otid.station.test",
            cipher = cipher,
            fileStore = credentialStore,
            nowEpochMs = { NOW_EPOCH_MS },
        )

        fun pairingVault(): StationPairingVault = StationPairingVault(
            packageName = "se.otid.station.test",
            cipher = cipher,
            fileStore = pairingStore,
            secretSource = PairingSecretSource { CREDENTIAL_SECRET.copyOf() },
            attemptIdSource = { ATTEMPT_ID },
            nowEpochMs = { NOW_EPOCH_MS },
        )
    }

    private class FakeConnection(
        private val status: Int,
        responseText: String,
        private val failResponseRead: Boolean = false,
    ) : HttpURLConnection(URL("https://example.test/")) {
        private val responseBytes = responseText.toByteArray(StandardCharsets.UTF_8)
        val requestBody = ByteArrayOutputStream()
        var requestedUrl: String? = null

        override fun disconnect() = Unit
        override fun usingProxy(): Boolean = false
        override fun connect() = Unit
        override fun getResponseCode(): Int = status
        override fun getInputStream() = if (failResponseRead) throw IOException("lost response") else ByteArrayInputStream(responseBytes)
        override fun getErrorStream() = if (status >= 400) ByteArrayInputStream(responseBytes) else null
        override fun getOutputStream() = requestBody
        override fun getHeaderField(name: String?): String? = when (name?.lowercase()) {
            "content-length" -> responseBytes.size.toString()
            else -> null
        }
    }

    companion object {
        private const val BASE_URL = "https://example.test/otid/"
        private const val GRANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        private const val OTHER_GRANT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        private const val ATTEMPT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        private const val OTHER_ATTEMPT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        private const val CREDENTIAL_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        private const val OLD_CREDENTIAL_ID = "99999999-9999-4999-8999-999999999999"
        private const val DEVICE_ID = "55555555-5555-4555-8555-555555555555"
        private const val RACE_ID = "11111111-1111-4111-8111-111111111111"
        private const val SESSION_ID = "22222222-2222-4222-8222-222222222222"
        private const val NOW_EPOCH_MS = 1_788_174_000_000L
        private val CREDENTIAL_SECRET = ByteArray(32) { (it + 2).toByte() }
        private val GRANT_TOKEN = "otid_pair_v1.$GRANT_ID.${Base64Url.encode(ByteArray(32) { (it + 1).toByte() })}"
    }
}

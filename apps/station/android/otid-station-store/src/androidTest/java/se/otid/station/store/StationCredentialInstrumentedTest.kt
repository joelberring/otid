package se.otid.station.store

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
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
class StationCredentialInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val credentialFiles = mutableListOf<File>()
    private val keyAliases = mutableListOf<String>()
    private val databaseNames = mutableListOf<String>()

    @After
    fun removeTestState() {
        credentialFiles.forEach { file ->
            file.delete()
            File(file.path + ".bak").delete()
            File(file.path + ".new").delete()
        }
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        keyAliases.forEach { alias -> if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias) }
        databaseNames.forEach(context::deleteDatabase)
    }

    @Test
    fun keystoreCredentialIsEncryptedInNoBackupAndMetadataSurvivesReopen() {
        val fixture = vaultFixture()
        var now = NOW_EPOCH_MS
        val vault = fixture.vault { now }
        val json = credentialJson()
        val token = JSONObject(json).getString("token")

        val installed = vault.install(json, DEVICE_ID)
        val firstEnvelope = CredentialEnvelopeCodec.decode(fixture.fileStore.read())
        val key = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getKey(fixture.keyAlias, null)

        assertEquals(CREDENTIAL_ID, installed.credentialId)
        assertEquals(context.noBackupFilesDir.canonicalFile, fixture.fileStore.file.parentFile!!.canonicalFile)
        assertFalse(String(fixture.fileStore.read(), StandardCharsets.UTF_8).contains(token))
        assertFalse(String(fixture.fileStore.read(), StandardCharsets.UTF_8).contains(DEVICE_ID))
        assertNull(key.encoded)
        assertEquals(installed, (fixture.vault { now }.status(DEVICE_ID) as StationCredentialStatus.Active).credential)

        val rotated = fixture.vault { now }.install(
            credentialJson(generation = 2, credentialId = ROTATED_CREDENTIAL_ID),
            DEVICE_ID,
        )
        val secondEnvelope = CredentialEnvelopeCodec.decode(fixture.fileStore.read())
        assertEquals(2, rotated.generation)
        assertFalse(firstEnvelope.initializationVector.contentEquals(secondEnvelope.initializationVector))
        assertNotEquals(token, JSONObject(credentialJson(generation = 2, credentialId = ROTATED_CREDENTIAL_ID)).getString("token"))

        now = EXPIRED_EPOCH_MS
        val expired = fixture.vault { now }.status(DEVICE_ID) as StationCredentialStatus.Expired
        assertEquals(ROTATED_CREDENTIAL_ID, expired.credential.credentialId)
    }

    @Test
    fun strictInstallRejectsMalformedMismatchedExpiredRollbackAndEquivocation() {
        val fixture = vaultFixture()
        val vault = fixture.vault { NOW_EPOCH_MS }
        val valid = credentialJson(generation = 2)
        vault.install(valid, DEVICE_ID)

        val invalid = listOf(
            JSONObject(valid).put("extra", true).toString(),
            JSONObject(valid).put("deviceId", OTHER_DEVICE_ID).toString(),
            credentialJson(generation = 1),
            JSONObject(valid).put("expiresAt", "2026-08-31T11:00:00.000Z").toString(),
            JSONObject(valid).put("expiresAt", "2026-09-02T10:00:00.000Z").toString(),
        )
        invalid.forEach { candidate ->
            val failure = assertThrows(StationStoreFailure::class.java) {
                vault.install(candidate, DEVICE_ID)
            }
            assertEquals(StationStoreErrors.INVALID_CREDENTIAL, failure.code)
        }
        assertEquals(2, (fixture.vault { NOW_EPOCH_MS }.status(DEVICE_ID) as StationCredentialStatus.Active).credential.generation)
    }

    @Test
    fun tamperMissingKeyAndAtomicFailureDoNotChangeStationDatabase() {
        val databaseName = databaseName()
        val store = StationStore(StationStoreDatabase(context, databaseName))
        store.installPackage(testPackage())
        store.enqueueEvent(enqueueRequest())
        val statusBefore = store.getStatus()
        val fixture = vaultFixture()
        val vault = fixture.vault { NOW_EPOCH_MS }
        val firstJson = credentialJson(generation = 1)
        vault.install(firstJson, statusBefore.deviceId)

        val failingStore = AtomicCredentialFileStore(
            context,
            fixture.fileStore.file.name,
            CredentialFileHooks(
                beforeFinishWrite = StationStoreFailureHook {
                    throw StationStoreFailure(StationStoreErrors.CREDENTIAL_STORAGE, "injected")
                },
            ),
        )
        val failingVault = StationCredentialVault(
            context.packageName,
            fixture.cipher,
            failingStore,
        ) { NOW_EPOCH_MS }
        assertThrows(StationStoreFailure::class.java) {
            failingVault.install(
                credentialJson(generation = 2, credentialId = ROTATED_CREDENTIAL_ID, deviceId = statusBefore.deviceId),
                statusBefore.deviceId,
            )
        }
        assertEquals(1, (fixture.vault { NOW_EPOCH_MS }.status(statusBefore.deviceId) as StationCredentialStatus.Active).credential.generation)

        fixture.fileStore.file.writeText("tampered", Charsets.UTF_8)
        assertEquals(StationCredentialStatus.Invalid, fixture.vault { NOW_EPOCH_MS }.status(statusBefore.deviceId))
        vault.install(firstJson, statusBefore.deviceId)
        KeyStore.getInstance("AndroidKeyStore").apply {
            load(null)
            deleteEntry(fixture.keyAlias)
        }
        assertEquals(StationCredentialStatus.Invalid, fixture.vault { NOW_EPOCH_MS }.status(statusBefore.deviceId))

        val statusAfter = store.getStatus()
        assertEquals(statusBefore.deviceId, statusAfter.deviceId)
        assertEquals(statusBefore.pendingCount, statusAfter.pendingCount)
        assertEquals(1, store.listPending(10).size)
        store.close()
    }

    @Test
    fun nativeClientInjectsCredentialForExactGetAndPostWithoutChangingOutboxOnAuthOrNetworkFailure() {
        val databaseName = databaseName()
        val store = StationStore(StationStoreDatabase(context, databaseName))
        store.installPackage(testPackage())
        val pending = store.enqueueEvent(enqueueRequest())
        val credential = StationCredentialParser.parse(
            credentialJson(deviceId = pending.deviceId),
        )

        val getConnection = FakeConnection(200, "{\"package\":true}")
        val getClient = AuthorizedStationHttpClient(StationConnectionFactory { requestedUrl ->
            getConnection.requestedUrl = requestedUrl
            getConnection
        })
        val getResponse = getClient.execute(
            AuthorizedStationRequest(
                baseUrl = "https://example.test/otid/",
                raceId = RACE_ID,
                resource = "station-package",
                method = "GET",
                bodyJson = null,
                idempotencyKey = null,
                connectTimeoutMs = 1_000,
                readTimeoutMs = 2_000,
            ),
            credential,
        )
        assertEquals(200, getResponse.status)
        assertEquals("Bearer ${credential.token}", getConnection.getRequestProperty("Authorization"))
        assertEquals("https://example.test/otid/api/races/$RACE_ID/station-package", getConnection.requestedUrl)
        assertEquals(0, getConnection.requestBody.size())
        assertFalse(getResponse.headers.containsKey("authorization"))

        val body = deviceBatchJson(pending)
        val postConnection = FakeConnection(401, "{\"error\":\"unauthorized\"}")
        val postClient = AuthorizedStationHttpClient(StationConnectionFactory { requestedUrl ->
            postConnection.requestedUrl = requestedUrl
            postConnection
        })
        val postResponse = postClient.execute(
            AuthorizedStationRequest(
                baseUrl = "https://example.test/otid/",
                raceId = RACE_ID,
                resource = "device-batches",
                method = "POST",
                bodyJson = body,
                idempotencyKey = "${pending.deviceId}:1:1",
                connectTimeoutMs = 1_000,
                readTimeoutMs = 2_000,
            ),
            credential,
        )
        assertEquals(401, postResponse.status)
        assertEquals(body, postConnection.requestBody.toString(StandardCharsets.UTF_8.name()))
        assertEquals("Bearer ${credential.token}", postConnection.getRequestProperty("Authorization"))
        assertEquals(1, store.getStatus().pendingCount)

        val networkFailure = AuthorizedStationHttpClient(StationConnectionFactory { throw IOException("offline") })
        val failure = assertThrows(StationStoreFailure::class.java) {
            networkFailure.execute(
                AuthorizedStationRequest(
                    "https://example.test/",
                    RACE_ID,
                    "station-package",
                    "GET",
                    null,
                    null,
                    1_000,
                    2_000,
                ),
                credential,
            )
        }
        assertEquals(StationStoreErrors.AUTHORIZED_REQUEST, failure.code)
        assertEquals(1, store.getStatus().pendingCount)
        store.close()
    }

    @Test
    fun nativeClientRejectsUnscopedBodiesRoutesAndCredentialEcho() {
        val credential = StationCredentialParser.parse(credentialJson())
        val client = AuthorizedStationHttpClient(StationConnectionFactory { FakeConnection(200, "{}") })
        val wrongBody = JSONObject(deviceBatchJson(storedEvent())).put("deviceId", OTHER_DEVICE_ID).toString()
        listOf(
            AuthorizedStationRequest("https://example.test/", RACE_ID, "other", "GET", null, null, 1_000, 2_000),
            AuthorizedStationRequest("https://example.test/", OTHER_RACE_ID, "station-package", "GET", null, null, 1_000, 2_000),
            AuthorizedStationRequest("https://example.test/", RACE_ID, "device-batches", "POST", wrongBody, "$DEVICE_ID:1:1", 1_000, 2_000),
        ).forEach { request ->
            assertThrows(StationStoreFailure::class.java) { client.execute(request, credential) }
        }

        val echoClient = AuthorizedStationHttpClient(StationConnectionFactory {
            FakeConnection(200, credential.token)
        })
        assertThrows(StationStoreFailure::class.java) {
            echoClient.execute(
                AuthorizedStationRequest("https://example.test/", RACE_ID, "station-package", "GET", null, null, 1_000, 2_000),
                credential,
            )
        }
    }

    private fun vaultFixture(): VaultFixture {
        val suffix = UUID.randomUUID().toString()
        val keyAlias = "se.otid.station.test.$suffix"
        val fileStore = AtomicCredentialFileStore(context, "station-device-credential-$suffix")
        keyAliases += keyAlias
        credentialFiles += fileStore.file
        return VaultFixture(keyAlias, AndroidKeystoreCredentialCipher(keyAlias), fileStore)
    }

    private fun credentialJson(
        generation: Int = 1,
        credentialId: String = CREDENTIAL_ID,
        deviceId: String = DEVICE_ID,
    ): String {
        val secret = ByteArray(32) { index -> (index + generation).toByte() }
        return JSONObject()
            .put("formatVersion", 1)
            .put("token", "otid_stn_v1.$credentialId.${Base64Url.encode(secret)}")
            .put("credentialId", credentialId)
            .put("deviceId", deviceId)
            .put("raceId", RACE_ID)
            .put("scope", "READOUT")
            .put("generation", generation)
            .put("issuedAt", "2026-08-31T10:00:00.000Z")
            .put("expiresAt", "2026-09-01T10:00:00.000Z")
            .toString()
    }

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

    private fun deviceBatchJson(event: StoredOutboxEvent): String = JSONObject()
        .put("deviceId", event.deviceId)
        .put("sessionId", event.sessionId)
        .put("packageVersion", event.packageVersion)
        .put("firstSequence", event.localSequence)
        .put("lastSequence", event.localSequence)
        .put(
            "events",
            JSONArray().put(
                JSONObject()
                    .put("localSequence", event.localSequence)
                    .put("stationReceivedAt", event.stationReceivedAt)
                    .put("transport", event.transport)
                    .put("payload", JSONObject(event.payloadJson))
                    .put("contentHash", event.contentHash),
            ),
        )
        .toString()

    private fun storedEvent(): StoredOutboxEvent = StoredOutboxEvent(
        deviceId = DEVICE_ID,
        localSequence = 1,
        sessionId = SESSION_ID,
        raceId = RACE_ID,
        packageVersion = 1,
        stationReceivedAt = "2026-08-31T12:00:01.000Z",
        transport = "simulator",
        payloadJson = "{}",
        contentHash = "a".repeat(64),
    )

    private fun databaseName(): String = "otid-station-auth-${UUID.randomUUID()}.db".also(databaseNames::add)

    private data class VaultFixture(
        val keyAlias: String,
        val cipher: AndroidKeystoreCredentialCipher,
        val fileStore: AtomicCredentialFileStore,
    ) {
        fun vault(now: () -> Long): StationCredentialVault = StationCredentialVault(
            packageName = "se.otid.station.test",
            cipher = cipher,
            fileStore = fileStore,
            nowEpochMs = now,
        )
    }

    private class FakeConnection(
        private val status: Int,
        responseText: String,
    ) : HttpURLConnection(URL("https://example.test/")) {
        private val responseBytes = responseText.toByteArray(StandardCharsets.UTF_8)
        val requestBody = ByteArrayOutputStream()
        var requestedUrl: String? = null

        override fun disconnect() = Unit
        override fun usingProxy(): Boolean = false
        override fun connect() = Unit
        override fun getResponseCode(): Int = status
        override fun getInputStream() = ByteArrayInputStream(responseBytes)
        override fun getErrorStream() = if (status >= 400) ByteArrayInputStream(responseBytes) else null
        override fun getOutputStream() = requestBody
        override fun getHeaderField(name: String?): String? = when (name?.lowercase()) {
            "content-length" -> responseBytes.size.toString()
            "content-type" -> "application/json"
            "authorization" -> "should-not-be-exposed"
            else -> null
        }
        override fun getHeaderFields(): MutableMap<String, MutableList<String>> = linkedMapOf(
            "Content-Length" to mutableListOf(responseBytes.size.toString()),
            "Content-Type" to mutableListOf("application/json"),
            "Authorization" to mutableListOf("should-not-be-exposed"),
        )
    }

    companion object {
        private const val CREDENTIAL_ID = "33333333-3333-4333-8333-33333333333a"
        private const val ROTATED_CREDENTIAL_ID = "44444444-4444-4444-8444-44444444444b"
        private const val DEVICE_ID = "55555555-5555-4555-8555-555555555555"
        private const val OTHER_DEVICE_ID = "66666666-6666-4666-8666-666666666666"
        private const val RACE_ID = "11111111-1111-4111-8111-111111111111"
        private const val OTHER_RACE_ID = "77777777-7777-4777-8777-777777777777"
        private const val SESSION_ID = "22222222-2222-4222-8222-222222222222"
        private const val NOW_EPOCH_MS = 1_788_174_000_000L
        private const val EXPIRED_EPOCH_MS = 1_788_260_400_000L
    }
}

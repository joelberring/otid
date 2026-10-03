package se.otid.station.store

import android.content.Context
import android.database.sqlite.SQLiteException
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.nio.charset.StandardCharsets
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class StationStoreInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val databaseNames = mutableListOf<String>()

    @After
    fun removeTestDatabases() {
        databaseNames.forEach(context::deleteDatabase)
    }

    @Test
    fun packageIdentityAndPendingEventSurviveDatabaseReopen() {
        val databaseName = databaseName()
        val firstDatabase = StationStoreDatabase(context, databaseName)
        val firstStore = StationStore(firstDatabase)
        firstStore.installPackage(testPackage(version = 1))
        val before = firstStore.getStatus()
        val request = enqueueRequest(version = 1)
        val stored = firstStore.enqueueEvent(request)
        assertEquals(1, stored.localSequence)
        firstStore.close()

        val reopenedDatabase = StationStoreDatabase(context, databaseName)
        val reopenedStore = StationStore(reopenedDatabase)
        val after = reopenedStore.getStatus()
        val pending = reopenedStore.listPending(100)

        assertEquals(before.deviceId, after.deviceId)
        assertEquals(2, after.nextLocalSequence)
        assertEquals(1, after.readoutCount)
        assertEquals(1, after.pendingCount)
        assertEquals(0, after.acknowledgedCount)
        assertEquals(0, after.rejectedCount)
        assertEquals(null, after.latestLocalEvaluation)
        assertEquals(1, after.activePackages.single().packageVersion)
        assertEquals(request.payloadJson, pending.single().payloadJson)
        assertEquals(request.contentHash, pending.single().contentHash)
        assertEquals("wal", pragmaText(reopenedDatabase, "journal_mode").lowercase())
        assertEquals("2", pragmaText(reopenedDatabase, "synchronous"))
        assertEquals("1", pragmaText(reopenedDatabase, "foreign_keys"))
        reopenedStore.close()
    }

    @Test
    fun enqueueFailureBeforeCommitRollsBackRowAndSequence() {
        val database = StationStoreDatabase(context, databaseName())
        val setup = StationStore(database)
        setup.installPackage(testPackage(version = 1))
        val failing = StationStore(
            database,
            StationStoreHooks(afterOutboxInsert = StationStoreFailureHook { error("injected") }),
        )

        assertThrows(IllegalStateException::class.java) { failing.enqueueEvent(enqueueRequest(version = 1)) }

        assertEquals(1, setup.getStatus().nextLocalSequence)
        assertEquals(0, setup.getStatus().pendingCount)
        assertTrue(setup.listPending(100).isEmpty())
        setup.close()
    }

    @Test
    fun hashMismatchAndMissingActivePackageDoNotConsumeASequence() {
        val database = StationStoreDatabase(context, databaseName())
        val store = StationStore(database)
        val noPackage = assertThrows(StationStoreFailure::class.java) {
            store.enqueueEvent(enqueueRequest(version = 1))
        }
        assertEquals(StationStoreErrors.NO_ACTIVE_PACKAGE, noPackage.code)
        store.installPackage(testPackage(version = 1))

        val hashMismatch = assertThrows(StationStoreFailure::class.java) {
            store.enqueueEvent(enqueueRequest(version = 1).copy(contentHash = "f".repeat(64)))
        }

        assertEquals(StationStoreErrors.HASH_MISMATCH, hashMismatch.code)
        assertEquals(1, store.getStatus().nextLocalSequence)
        assertEquals(0, store.getStatus().pendingCount)
        store.close()
    }

    @Test
    fun duplicateConflictDowngradeAndActivationFailureKeepActivePackageConsistent() {
        val databaseName = databaseName()
        val database = StationStoreDatabase(context, databaseName)
        val store = StationStore(database)
        val versionOne = testPackage(version = 1)
        val versionTwo = testPackage(version = 2)

        assertEquals("installed", store.installPackage(versionOne).status)
        assertEquals("duplicate", store.installPackage(versionOne).status)
        val conflict = assertThrows(StationStoreFailure::class.java) {
            store.installPackage(testPackage(version = 1, suffix = "conflict"))
        }
        assertEquals(StationStoreErrors.PACKAGE_VERSION_CONFLICT, conflict.code)
        store.installPackage(versionTwo)
        val rollback = assertThrows(StationStoreFailure::class.java) { store.installPackage(versionOne) }
        assertEquals(StationStoreErrors.PACKAGE_ROLLBACK, rollback.code)

        val failing = StationStore(
            database,
            StationStoreHooks(afterPackageInsert = StationStoreFailureHook { error("injected") }),
        )
        assertThrows(IllegalStateException::class.java) { failing.installPackage(testPackage(version = 3)) }
        store.close()

        val reopenedDatabase = StationStoreDatabase(context, databaseName)
        val reopened = StationStore(reopenedDatabase)
        assertEquals(2, reopened.getStatus().activePackages.single().packageVersion)
        assertEquals("installed", reopened.installPackage(testPackage(version = 3)).status)
        reopened.close()
    }

    @Test
    fun exactAcknowledgementsAreAtomicRetainedAndIdempotentAcrossReopen() {
        val databaseName = databaseName()
        val database = StationStoreDatabase(context, databaseName)
        val store = StationStore(database)
        store.installPackage(testPackage(version = 1))
        val first = store.enqueueEvent(enqueueRequest(version = 1, card = "1"))
        val second = store.enqueueEvent(enqueueRequest(version = 1, card = "2"))
        val third = store.enqueueEvent(enqueueRequest(version = 1, card = "3"))
        val acknowledgement = acknowledgement(
            first.deviceId,
            listOf(
                acknowledgedEvent(first, "stored"),
                rejectedEvent(second, "SEQUENCE_CONTEXT_CONFLICT"),
                acknowledgedEvent(third, "duplicate"),
            ),
        )

        val applied = store.applyAcknowledgements(AcknowledgementParser.parse(acknowledgement))
        assertEquals(2, applied.acknowledgedCount)
        assertEquals(1, applied.rejectedCount)
        assertEquals(0, applied.pendingCount)
        assertEquals(3, rowCount(database, "outbox_event"))
        assertEquals(1, rowCount(database, "acknowledgement_receipt"))
        assertEquals(3, rowCount(database, "server_ack_observation"))
        assertEquals(3, store.getStatus().readoutCount)
        assertEquals(2, store.getStatus().acknowledgedCount)
        assertEquals(1, store.getStatus().rejectedCount)

        val repeated = store.applyAcknowledgements(AcknowledgementParser.parse(acknowledgement))
        assertEquals(3, repeated.unchangedCount)
        assertEquals(1, rowCount(database, "acknowledgement_receipt"))
        assertEquals(3, rowCount(database, "server_ack_observation"))
        val contradiction = assertThrows(StationStoreFailure::class.java) {
            store.applyAcknowledgements(
                AcknowledgementParser.parse(
                    acknowledgement(
                        first.deviceId,
                        listOf(rejectedEvent(first, "SEQUENCE_CONTEXT_CONFLICT")),
                    ),
                ),
            )
        }
        assertEquals(StationStoreErrors.ACK_CONFLICT, contradiction.code)
        assertEquals("ACKNOWLEDGED", outboxState(database, first))
        store.close()

        val reopenedDatabase = StationStoreDatabase(context, databaseName)
        val reopened = StationStore(reopenedDatabase)
        assertEquals(0, reopened.getStatus().pendingCount)
        assertEquals(3, rowCount(reopenedDatabase, "outbox_event"))
        reopened.close()
    }

    @Test
    fun oneMismatchingEventRollsBackTheEntireAcknowledgementBatch() {
        val database = StationStoreDatabase(context, databaseName())
        val store = StationStore(database)
        store.installPackage(testPackage(version = 1))
        val first = store.enqueueEvent(enqueueRequest(version = 1, card = "1"))
        val second = store.enqueueEvent(enqueueRequest(version = 1, card = "2"))
        val invalidBatch = acknowledgement(
            first.deviceId,
            listOf(
                acknowledgedEvent(first, "stored"),
                acknowledgedEvent(second.copy(contentHash = "f".repeat(64)), "stored"),
            ),
        )

        val wrongDevice = assertThrows(StationStoreFailure::class.java) {
            store.applyAcknowledgements(
                AcknowledgementParser.parse(
                    acknowledgement(OTHER_DEVICE_ID, listOf(acknowledgedEvent(first, "stored"))),
                ),
            )
        }
        assertEquals(StationStoreErrors.ACK_CONFLICT, wrongDevice.code)
        val wrongSequence = assertThrows(StationStoreFailure::class.java) {
            store.applyAcknowledgements(
                AcknowledgementParser.parse(
                    acknowledgement(
                        first.deviceId,
                        listOf(acknowledgedEvent(first.copy(localSequence = 99), "stored")),
                    ),
                ),
            )
        }
        assertEquals(StationStoreErrors.ACK_CONFLICT, wrongSequence.code)

        val failure = assertThrows(StationStoreFailure::class.java) {
            store.applyAcknowledgements(AcknowledgementParser.parse(invalidBatch))
        }

        assertEquals(StationStoreErrors.ACK_CONFLICT, failure.code)
        assertEquals(2, store.getStatus().pendingCount)
        assertEquals(0, rowCount(database, "acknowledgement_receipt"))
        store.close()
    }

    @Test
    fun acknowledgementFailureBeforeCommitLeavesAllEventsPending() {
        val database = StationStoreDatabase(context, databaseName())
        val setup = StationStore(database)
        setup.installPackage(testPackage(version = 1))
        val event = setup.enqueueEvent(enqueueRequest(version = 1))
        val failing = StationStore(
            database,
            StationStoreHooks(afterAcknowledgementObservationInsert = StationStoreFailureHook { error("injected") }),
        )

        assertThrows(IllegalStateException::class.java) {
            failing.applyAcknowledgements(
                AcknowledgementParser.parse(
                    acknowledgement(event.deviceId, listOf(acknowledgedEvent(event, "stored"))),
                ),
            )
        }

        assertEquals(1, setup.getStatus().pendingCount)
        assertEquals(0, rowCount(database, "acknowledgement_receipt"))
        assertEquals(0, rowCount(database, "server_ack_observation"))
        setup.close()
    }

    @Test
    fun serverOutcomesAndPackageStatusAreAppendOnlyIdempotentAndRecovered() {
        val databaseName = databaseName()
        val database = StationStoreDatabase(context, databaseName)
        val store = StationStore(database)
        val packageData = testPackage(version = 1)
        store.installPackage(packageData)
        val event = store.enqueueEvent(enqueueRequest(version = 1))
        val local = localEvaluation(event, packageData, "UNKNOWN_CARD", "UNKNOWN_CARD")
        store.recordLocalEvaluation(local)
        val rawMessageId = "77777777-7777-4777-8777-777777777777"
        val firstEvent = acknowledgedEvent(
            event,
            status = "stored",
            rawMessageId = rawMessageId,
            serverResult = unknownCardServerResult("b".repeat(64)),
        )
        val firstAcknowledgement = acknowledgement(event.deviceId, listOf(firstEvent))

        val first = store.applyAcknowledgements(AcknowledgementParser.parse(firstAcknowledgement))
        assertEquals(1, first.acknowledgedCount)
        assertEquals(1, rowCount(database, "acknowledgement_receipt"))
        assertEquals(1, rowCount(database, "server_ack_observation"))
        val initialPair = store.loadLatestEvaluationPair(RACE_ID)!!
        assertEquals(local.evaluationHash, initialPair.localEvaluation?.evaluationHash)
        assertEquals("b".repeat(64), initialPair.serverObservation?.evaluationHash)
        assertEquals(1, initialPair.serverObservation?.currentPackageVersion)
        assertEquals("current", initialPair.serverObservation?.packageVersionStatus)
        assertEquals(false, initialPair.serverObservation?.packageUpdateRequired)

        val exactRetry = store.applyAcknowledgements(AcknowledgementParser.parse(firstAcknowledgement))
        assertEquals(1, exactRetry.unchangedCount)
        assertEquals(1, rowCount(database, "acknowledgement_receipt"))
        assertEquals(1, rowCount(database, "server_ack_observation"))

        val packageStatusChanged = acknowledgement(
            event.deviceId,
            listOf(firstEvent),
            currentPackageVersion = 2,
            packageVersionStatus = "stale",
            packageUpdateRequired = true,
        )
        store.applyAcknowledgements(AcknowledgementParser.parse(packageStatusChanged))
        assertEquals(2, rowCount(database, "acknowledgement_receipt"))
        assertEquals(2, rowCount(database, "server_ack_observation"))

        val changedResult = acknowledgement(
            event.deviceId,
            listOf(
                acknowledgedEvent(
                    event,
                    status = "duplicate",
                    rawMessageId = rawMessageId,
                    serverResult = unknownCardServerResult("c".repeat(64)),
                ),
            ),
            currentPackageVersion = 2,
            packageVersionStatus = "stale",
            packageUpdateRequired = true,
        )
        store.applyAcknowledgements(AcknowledgementParser.parse(changedResult))
        assertEquals(3, rowCount(database, "acknowledgement_receipt"))
        assertEquals(3, rowCount(database, "server_ack_observation"))
        val latest = store.loadLatestEvaluationPair(RACE_ID)!!
        assertEquals("ACKNOWLEDGED", latest.outboxState)
        assertEquals(rawMessageId, latest.serverObservation?.rawMessageId)
        assertEquals("duplicate", latest.serverObservation?.acknowledgementStatus)
        assertEquals("c".repeat(64), latest.serverObservation?.evaluationHash)
        assertEquals(2, latest.serverObservation?.currentPackageVersion)
        assertEquals("stale", latest.serverObservation?.packageVersionStatus)
        assertEquals(true, latest.serverObservation?.packageUpdateRequired)

        val rawIdConflict = assertThrows(StationStoreFailure::class.java) {
            store.applyAcknowledgements(
                AcknowledgementParser.parse(
                    acknowledgement(
                        event.deviceId,
                        listOf(
                            acknowledgedEvent(
                                event,
                                "duplicate",
                                rawMessageId = OTHER_RAW_MESSAGE_ID,
                                serverResult = unknownCardServerResult("c".repeat(64)),
                            ),
                        ),
                    ),
                ),
            )
        }
        assertEquals(StationStoreErrors.ACK_CONFLICT, rawIdConflict.code)
        assertEquals(3, rowCount(database, "acknowledgement_receipt"))
        assertThrows(SQLiteException::class.java) {
            database.writableDatabase.execSQL(
                "UPDATE server_ack_observation SET evaluation_hash = ? WHERE device_id = ? AND local_sequence = ?",
                arrayOf<Any>("d".repeat(64), event.deviceId, event.localSequence),
            )
        }
        assertThrows(SQLiteException::class.java) {
            database.writableDatabase.execSQL(
                "DELETE FROM server_ack_observation WHERE device_id = ? AND local_sequence = ?",
                arrayOf<Any>(event.deviceId, event.localSequence),
            )
        }
        store.close()

        val reopened = StationStore(StationStoreDatabase(context, databaseName))
        val recovered = reopened.loadLatestEvaluationPair(RACE_ID)!!
        assertEquals(local.evaluationHash, recovered.localEvaluation?.evaluationHash)
        assertEquals("c".repeat(64), recovered.serverObservation?.evaluationHash)
        assertEquals("stale", recovered.serverObservation?.packageVersionStatus)
        reopened.close()
    }

    @Test
    fun normalizedBaseUrlSurvivesReopenAndInvalidValueDoesNotOverwriteIt() {
        val databaseName = databaseName()
        val store = StationStore(StationStoreDatabase(context, databaseName))
        assertEquals(null, store.loadBaseUrl())
        assertEquals("https://example.test/otid/", store.saveBaseUrl("HTTPS://Example.Test:443/a/../otid"))
        val failure = assertThrows(StationStoreFailure::class.java) {
            store.saveBaseUrl("https://user:token@example.test/")
        }
        assertEquals(StationStoreErrors.INVALID_ARGUMENT, failure.code)
        assertEquals("https://example.test/otid/", store.loadBaseUrl())
        store.close()

        StationStore(StationStoreDatabase(context, databaseName)).use { reopened ->
            assertEquals("https://example.test/otid/", reopened.loadBaseUrl())
        }
    }

    @Test
    fun serverResultWireIsStrictAndRequiresEvaluationHash() {
        val event = StoredOutboxEvent(
            deviceId = OTHER_DEVICE_ID,
            localSequence = 1,
            sessionId = SESSION_ID,
            raceId = RACE_ID,
            packageVersion = 1,
            stationReceivedAt = "2026-08-31T12:00:01.000Z",
            transport = "simulator",
            payloadJson = "{}",
            contentHash = "a".repeat(64),
        )
        val missingEvaluationHash = JSONObject()
            .put("status", "UNKNOWN_CARD")
            .put("reason", "UNKNOWN_CARD")
            .put("engineVersion", "0.1.0")
            .put("snapshotVersion", 1)
        val failure = assertThrows(StationStoreFailure::class.java) {
            AcknowledgementParser.parse(
                acknowledgement(
                    event.deviceId,
                    listOf(acknowledgedEvent(event, "stored", serverResult = missingEvaluationHash)),
                ),
            )
        }
        assertEquals(StationStoreErrors.INVALID_ARGUMENT, failure.code)
    }

    @Test
    fun activePackageIsHashCheckedStrictUtf8AndSurvivesReopen() {
        val databaseName = databaseName()
        val packageData = testPackage(version = 1)
        StationStore(StationStoreDatabase(context, databaseName)).use { store ->
            store.installPackage(packageData)
            val loaded = store.loadActivePackage(RACE_ID)
            assertEquals(packageData.payloadSha256, loaded.payloadSha256)
            assertEquals(String(packageData.payloadBytes, StandardCharsets.UTF_8), loaded.payloadJson)
        }
        val reopenedDatabase = StationStoreDatabase(context, databaseName)
        val reopened = StationStore(reopenedDatabase)
        assertEquals(packageData.payloadSha256, reopened.loadActivePackage(RACE_ID).payloadSha256)

        reopenedDatabase.writableDatabase.execSQL("DROP TRIGGER competition_package_no_update")
        reopenedDatabase.writableDatabase.execSQL(
            "UPDATE competition_package SET payload_bytes = ? WHERE race_id = ? AND package_version = 1",
            arrayOf<Any>("corrupt".toByteArray(StandardCharsets.UTF_8), RACE_ID),
        )
        val mismatch = assertThrows(StationStoreFailure::class.java) {
            reopened.loadActivePackage(RACE_ID)
        }
        assertEquals(StationStoreErrors.HASH_MISMATCH, mismatch.code)
        reopened.close()

        val invalidUtf8Name = databaseName()
        val invalidBytes = byteArrayOf(0xc3.toByte(), 0x28)
        StationStore(StationStoreDatabase(context, invalidUtf8Name)).use { store ->
            store.installPackage(
                testPackage(version = 1).copy(
                    payloadBytes = invalidBytes,
                    payloadSha256 = Rs256Crypto.sha256Hex(invalidBytes),
                ),
            )
            val invalid = assertThrows(StationStoreFailure::class.java) {
                store.loadActivePackage(RACE_ID)
            }
            assertEquals(StationStoreErrors.INVALID_PACKAGE, invalid.code)
        }
    }

    @Test
    fun localEvaluationIsAppendOnlyIdempotentAndRecoveredWithStatus() {
        val databaseName = databaseName()
        val database = StationStoreDatabase(context, databaseName)
        val store = StationStore(database)
        val packageData = testPackage(version = 1)
        store.installPackage(packageData)
        val first = store.enqueueEvent(enqueueRequest(version = 1, card = "100"))
        val second = store.enqueueEvent(enqueueRequest(version = 1, card = "200"))
        val firstRecord = localEvaluation(first, packageData, "OK", "COMPLETE")
        val secondRecord = localEvaluation(second, packageData, "MP", "MISSING_CONTROL")
        store.installPackage(testPackage(version = 2))

        assertEquals("stored", store.recordLocalEvaluation(firstRecord).status)
        assertEquals("duplicate", store.recordLocalEvaluation(firstRecord).status)
        assertEquals("stored", store.recordLocalEvaluation(secondRecord).status)
        val conflictJson = localEvaluation(second, packageData, "MP", "WRONG_ORDER")
        val conflict = assertThrows(StationStoreFailure::class.java) {
            store.recordLocalEvaluation(conflictJson)
        }
        assertEquals(StationStoreErrors.EVALUATION_CONFLICT, conflict.code)
        assertEquals(2, rowCount(database, "local_evaluation"))
        assertThrows(SQLiteException::class.java) {
            database.writableDatabase.execSQL(
                "UPDATE local_evaluation SET evaluation_hash = ? WHERE device_id = ? AND local_sequence = ?",
                arrayOf<Any>("f".repeat(64), first.deviceId, first.localSequence),
            )
        }
        assertThrows(SQLiteException::class.java) {
            database.writableDatabase.execSQL(
                "DELETE FROM local_evaluation WHERE device_id = ? AND local_sequence = ?",
                arrayOf<Any>(first.deviceId, first.localSequence),
            )
        }
        store.close()

        val reopenedDatabase = StationStoreDatabase(context, databaseName)
        val reopened = StationStore(reopenedDatabase)
        val status = reopened.getStatus()
        assertEquals(2, status.readoutCount)
        assertEquals(2, status.pendingCount)
        assertEquals(0, status.acknowledgedCount)
        assertEquals(0, status.rejectedCount)
        assertEquals(secondRecord.localEvaluationJson, status.latestLocalEvaluation?.localEvaluationJson)
        assertEquals(secondRecord.evaluationHash, status.latestLocalEvaluation?.evaluationHash)
        reopenedDatabase.writableDatabase.execSQL("DROP TRIGGER local_evaluation_no_update")
        reopenedDatabase.writableDatabase.execSQL(
            "UPDATE local_evaluation SET local_evaluation_json = '{}' WHERE device_id = ? AND local_sequence = ?",
            arrayOf<Any>(second.deviceId, second.localSequence),
        )
        val corruptLatest = assertThrows(StationStoreFailure::class.java) { reopened.getStatus() }
        assertEquals(StationStoreErrors.HASH_MISMATCH, corruptLatest.code)
        reopened.close()
    }

    @Test
    fun failedLocalEvaluationTransactionKeepsCommittedOutboxWithoutResult() {
        val database = StationStoreDatabase(context, databaseName())
        val setup = StationStore(database)
        val packageData = testPackage(version = 1)
        setup.installPackage(packageData)
        val event = setup.enqueueEvent(enqueueRequest(version = 1))
        val failing = StationStore(
            database,
            StationStoreHooks(afterLocalEvaluationInsert = StationStoreFailureHook { error("injected") }),
        )

        assertThrows(IllegalStateException::class.java) {
            failing.recordLocalEvaluation(localEvaluation(event, packageData, "OK", "COMPLETE"))
        }

        val status = setup.getStatus()
        assertEquals(2, status.nextLocalSequence)
        assertEquals(1, status.readoutCount)
        assertEquals(1, status.pendingCount)
        assertEquals(null, status.latestLocalEvaluation)
        assertEquals(0, rowCount(database, "local_evaluation"))
        setup.close()
    }

    @Test
    fun localEvaluationMustMatchTheFrozenOutboxAndInstalledPackage() {
        val database = StationStoreDatabase(context, databaseName())
        val store = StationStore(database)
        val packageData = testPackage(version = 1)
        store.installPackage(packageData)
        val event = store.enqueueEvent(enqueueRequest(version = 1))
        val record = localEvaluation(event, packageData, "UNKNOWN_CARD", "UNKNOWN_CARD")

        listOf(
            record.copy(localSequence = 99),
            record.copy(raceId = OTHER_RACE_ID),
            record.copy(packageVersion = 2, snapshotVersion = 2),
            record.copy(packagePayloadSha256 = "f".repeat(64)),
            record.copy(engineVersion = "9.9.9"),
            record.copy(snapshotVersion = 2),
        ).forEach { invalid ->
            val failure = assertThrows(StationStoreFailure::class.java) {
                store.recordLocalEvaluation(invalid)
            }
            assertEquals(StationStoreErrors.EVALUATION_CONFLICT, failure.code)
        }
        assertEquals(1, store.getStatus().readoutCount)
        assertEquals(0, rowCount(database, "local_evaluation"))
        store.close()
    }

    @Test
    fun localEvaluationWireRejectsHashMismatchAndNonCanonicalJson() {
        val nonCanonical = JSONObject()
            .put("snapshotVersion", 1)
            .put("engineVersion", "0.1.0")
            .put("evaluation", JSONObject().put("status", "OK"))
            .put("packagePayloadSha256", "a".repeat(64))
            .put("packageVersion", 1)
            .put("raceId", RACE_ID)
            .put("localSequence", 1)
            .put("deviceId", OTHER_DEVICE_ID)
            .put("formatVersion", 1)
            .toString()
        val nonCanonicalFailure = assertThrows(StationStoreFailure::class.java) {
            LocalEvaluationParser.parse(
                nonCanonical,
                Rs256Crypto.sha256Hex(nonCanonical.toByteArray(StandardCharsets.UTF_8)),
            )
        }
        assertEquals(StationStoreErrors.INVALID_ARGUMENT, nonCanonicalFailure.code)

        val canonical = String(
            CanonicalJson.encode(JSONObject().put("formatVersion", 1)),
            StandardCharsets.UTF_8,
        )
        val mismatch = assertThrows(StationStoreFailure::class.java) {
            LocalEvaluationParser.parse(canonical, "f".repeat(64))
        }
        assertEquals(StationStoreErrors.HASH_MISMATCH, mismatch.code)
    }

    @Test
    fun versionOneMigratesSequentiallyToThreeAndVersionThreeRejectsDowngrade() {
        val databaseName = databaseName()
        val versionOneDatabase = StationStoreDatabase(context, databaseName, targetVersion = 1)
        val versionOneStore = StationStore(versionOneDatabase)
        val packageData = testPackage(version = 1)
        versionOneStore.installPackage(packageData)
        val event = versionOneStore.enqueueEvent(enqueueRequest(version = 1))
        val identityBefore = stationIdentity(versionOneDatabase)
        versionOneStore.close()

        val migratedDatabase = StationStoreDatabase(context, databaseName)
        val migrated = StationStore(migratedDatabase)
        val after = migrated.getStatus()
        assertEquals(identityBefore, after.deviceId)
        assertEquals(2, after.nextLocalSequence)
        assertEquals(1, after.readoutCount)
        assertEquals(1, migrated.listPending(100).size)
        assertEquals(3, pragmaText(migratedDatabase, "user_version").toInt())
        assertEquals("stored", migrated.recordLocalEvaluation(
            localEvaluation(event, packageData, "OK", "COMPLETE"),
        ).status)
        migrated.close()

        val downgrade = StationStoreDatabase(context, databaseName, targetVersion = 1)
        val failure = assertThrows(StationStoreFailure::class.java) { downgrade.writableDatabase }
        assertEquals(StationStoreErrors.STORAGE_FAILURE, failure.code)
        downgrade.close()
    }

    @Test
    fun versionTwoMigratesAdditivelyToThreeWithoutLosingPriorRows() {
        val databaseName = databaseName()
        val versionTwoDatabase = StationStoreDatabase(context, databaseName, targetVersion = 2)
        val versionTwoStore = StationStore(versionTwoDatabase)
        val packageData = testPackage(version = 1)
        versionTwoStore.installPackage(packageData)
        val event = versionTwoStore.enqueueEvent(enqueueRequest(version = 1))
        val local = localEvaluation(event, packageData, "OK", "COMPLETE")
        versionTwoStore.recordLocalEvaluation(local)
        versionTwoDatabase.writableDatabase.execSQL(
            "INSERT INTO acknowledgement_receipt(device_id, acknowledgement_json, received_at_epoch_ms) VALUES (?, ?, ?)",
            arrayOf<Any>(event.deviceId, "{}", 1L),
        )
        versionTwoStore.close()

        val migratedDatabase = StationStoreDatabase(context, databaseName)
        val migrated = StationStore(migratedDatabase)
        assertEquals(3, pragmaText(migratedDatabase, "user_version").toInt())
        assertEquals(1, rowCount(migratedDatabase, "competition_package"))
        assertEquals(1, rowCount(migratedDatabase, "outbox_event"))
        assertEquals(1, rowCount(migratedDatabase, "local_evaluation"))
        assertEquals(1, rowCount(migratedDatabase, "acknowledgement_receipt"))
        assertEquals(0, rowCount(migratedDatabase, "server_ack_observation"))
        assertEquals(local.evaluationHash, migrated.loadLatestEvaluationPair(RACE_ID)?.localEvaluation?.evaluationHash)
        assertEquals(null, migrated.loadLatestEvaluationPair(RACE_ID)?.serverObservation)
        assertEquals(null, migrated.loadBaseUrl())
        migrated.close()
    }

    private fun testPackage(version: Int, suffix: String = "v$version"): VerifiedCompetitionPackage {
        val bytes = CanonicalJson.encode(
            JSONObject()
                .put("resultEngineVersion", "0.1.0")
                .put("suffix", suffix),
        )
        return VerifiedCompetitionPackage(
            raceId = RACE_ID,
            packageVersion = version,
            payloadSha256 = Rs256Crypto.sha256Hex(bytes),
            keyId = "a".repeat(64),
            envelopeJson = "{\"test\":\"$suffix\"}",
            payloadBytes = bytes,
        )
    }

    private fun localEvaluation(
        event: StoredOutboxEvent,
        packageData: VerifiedCompetitionPackage,
        status: String,
        reason: String,
    ): LocalEvaluationRecord {
        val value = JSONObject()
            .put("formatVersion", 1)
            .put("deviceId", event.deviceId)
            .put("localSequence", event.localSequence)
            .put("raceId", event.raceId)
            .put("packageVersion", event.packageVersion)
            .put("packagePayloadSha256", packageData.payloadSha256)
            .put("engineVersion", "0.1.0")
            .put("snapshotVersion", event.packageVersion)
            .put(
                "evaluation",
                JSONObject()
                    .put("status", status)
                    .put("reason", reason)
                    .put("missingControls", JSONArray())
                    .put("extraPunches", JSONArray())
                    .put("splits", JSONArray()),
            )
        val json = String(CanonicalJson.encode(value), StandardCharsets.UTF_8)
        return LocalEvaluationParser.parse(
            json,
            Rs256Crypto.sha256Hex(json.toByteArray(StandardCharsets.UTF_8)),
        )
    }

    private fun enqueueRequest(version: Int, card: String = "100"): EnqueueRequest {
        val payload = JSONObject()
            .put("cardNumber", card)
            .put("finishPunchedAt", "2026-08-31T12:00:00.000Z")
            .put("punches", JSONArray())
            .toString()
        return EnqueueRequest(
            raceId = RACE_ID,
            sessionId = SESSION_ID,
            packageVersion = version,
            stationReceivedAt = "2026-08-31T12:00:01.000Z",
            transport = "simulator",
            payloadJson = payload,
            contentHash = Rs256Crypto.sha256Hex(payload.toByteArray(StandardCharsets.UTF_8)),
        )
    }

    private fun acknowledgedEvent(
        event: StoredOutboxEvent,
        status: String,
        rawMessageId: String = UUID.randomUUID().toString(),
        serverResult: JSONObject? = null,
    ): JSONObject = JSONObject()
        .put("localSequence", event.localSequence)
        .put("contentHash", event.contentHash)
        .put("status", status)
        .put("rawMessageId", rawMessageId)
        .also { value -> if (serverResult != null) value.put("serverResult", serverResult) }

    private fun unknownCardServerResult(evaluationHash: String): JSONObject = JSONObject()
        .put("status", "UNKNOWN_CARD")
        .put("reason", "UNKNOWN_CARD")
        .put("engineVersion", "0.1.0")
        .put("snapshotVersion", 1)
        .put("evaluationHash", evaluationHash)

    private fun rejectedEvent(event: StoredOutboxEvent, reason: String): JSONObject = JSONObject()
        .put("localSequence", event.localSequence)
        .put("contentHash", event.contentHash)
        .put("status", "rejected")
        .put("reason", reason)

    private fun acknowledgement(
        deviceId: String,
        events: List<JSONObject>,
        currentPackageVersion: Int = 1,
        packageVersionStatus: String = "current",
        packageUpdateRequired: Boolean = false,
    ): String {
        val array = JSONArray()
        events.forEach(array::put)
        return JSONObject()
            .put("deviceId", deviceId)
            .put("highestContiguousSequence", events.size)
            .put("currentPackageVersion", currentPackageVersion)
            .put("packageVersionStatus", packageVersionStatus)
            .put("packageUpdateRequired", packageUpdateRequired)
            .put("acknowledgements", array)
            .toString()
    }

    private fun pragmaText(database: StationStoreDatabase, pragma: String): String =
        database.readableDatabase.rawQuery("PRAGMA $pragma", emptyArray()).use { cursor ->
            cursor.moveToFirst()
            cursor.getString(0)
        }

    private fun rowCount(database: StationStoreDatabase, table: String): Int =
        database.readableDatabase.rawQuery("SELECT count(*) FROM $table", emptyArray()).use { cursor ->
            cursor.moveToFirst()
            cursor.getInt(0)
        }

    private fun outboxState(database: StationStoreDatabase, event: StoredOutboxEvent): String =
        database.readableDatabase.rawQuery(
            "SELECT state FROM outbox_event WHERE device_id = ? AND local_sequence = ?",
            arrayOf(event.deviceId, event.localSequence.toString()),
        ).use { cursor ->
            cursor.moveToFirst()
            cursor.getString(0)
        }

    private fun stationIdentity(database: StationStoreDatabase): String =
        database.readableDatabase.rawQuery(
            "SELECT device_id FROM station_identity WHERE singleton_id = 1",
            emptyArray(),
        ).use { cursor ->
            cursor.moveToFirst()
            cursor.getString(0)
        }

    private fun databaseName(): String = "otid-station-${UUID.randomUUID()}.db".also(databaseNames::add)

    companion object {
        private const val RACE_ID = "11111111-1111-4111-8111-111111111111"
        private const val SESSION_ID = "22222222-2222-4222-8222-222222222222"
        private const val OTHER_DEVICE_ID = "55555555-5555-4555-8555-555555555555"
        private const val OTHER_RACE_ID = "66666666-6666-4666-8666-666666666666"
        private const val OTHER_RAW_MESSAGE_ID = "88888888-8888-4888-8888-888888888888"
    }
}

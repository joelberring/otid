package se.otid.station.store

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.UUID

class StationStore(
    private val database: StationStoreDatabase,
    private val hooks: StationStoreHooks = StationStoreHooks(),
) : AutoCloseable {
    fun installPackage(packageData: VerifiedCompetitionPackage): InstalledPackageMetadata = transaction { db ->
        val activeVersion = activePackageVersion(db, packageData.raceId)
        if (activeVersion != null && packageData.packageVersion < activeVersion) {
            fail(StationStoreErrors.PACKAGE_ROLLBACK, "En lägre paketversion får inte aktiveras")
        }

        val existingHash = installedPackageHash(db, packageData.raceId, packageData.packageVersion)
        if (existingHash != null) {
            if (existingHash != packageData.payloadSha256) {
                fail(
                    StationStoreErrors.PACKAGE_VERSION_CONFLICT,
                    "Samma paketversion är redan installerad med annat innehåll",
                )
            }
            return@transaction InstalledPackageMetadata(
                status = "duplicate",
                raceId = packageData.raceId,
                packageVersion = packageData.packageVersion,
                payloadSha256 = packageData.payloadSha256,
                keyId = packageData.keyId,
            )
        }

        val installedAt = System.currentTimeMillis()
        val values = ContentValues().apply {
            put("race_id", packageData.raceId)
            put("package_version", packageData.packageVersion)
            put("payload_sha256", packageData.payloadSha256)
            put("key_id", packageData.keyId)
            put("envelope_json", packageData.envelopeJson)
            put("payload_bytes", packageData.payloadBytes.copyOf())
            put("installed_at_epoch_ms", installedAt)
        }
        if (db.insertOrThrow("competition_package", null, values) == -1L) {
            fail(StationStoreErrors.STORAGE_FAILURE, "Tävlingspaketet kunde inte lagras")
        }
        hooks.afterPackageInsert.run()

        val pointer = ContentValues().apply { put("package_version", packageData.packageVersion) }
        if (db.update("active_package", pointer, "race_id = ?", arrayOf(packageData.raceId)) == 0) {
            pointer.put("race_id", packageData.raceId)
            db.insertOrThrow("active_package", null, pointer)
        }
        InstalledPackageMetadata(
            status = "installed",
            raceId = packageData.raceId,
            packageVersion = packageData.packageVersion,
            payloadSha256 = packageData.payloadSha256,
            keyId = packageData.keyId,
        )
    }

    fun loadActivePackage(raceId: String): LoadedActivePackage {
        requireUuid(raceId, "raceId")
        return storageCall {
            database.readableDatabase.rawQuery(
                """
                SELECT package.package_version, package.payload_sha256, package.key_id, package.payload_bytes
                FROM active_package active
                JOIN competition_package package
                  ON package.race_id = active.race_id
                 AND package.package_version = active.package_version
                WHERE active.race_id = ?
                """.trimIndent(),
                arrayOf(raceId),
            ).use { cursor ->
                if (!cursor.moveToFirst()) {
                    fail(StationStoreErrors.NO_ACTIVE_PACKAGE, "Loppet saknar ett aktivt tävlingspaket")
                }
                val payloadBytes = cursor.getBlob(3).copyOf()
                val storedHash = cursor.getString(1)
                if (Rs256Crypto.sha256Hex(payloadBytes) != storedHash) {
                    fail(StationStoreErrors.HASH_MISMATCH, "Det aktiva tävlingspaketets hash är ogiltig")
                }
                LoadedActivePackage(
                    raceId = raceId,
                    packageVersion = cursor.getInt(0),
                    payloadSha256 = storedHash,
                    keyId = cursor.getString(2),
                    payloadJson = StrictUtf8.decode(
                        payloadBytes,
                        StationStoreErrors.INVALID_PACKAGE,
                        "Det aktiva tävlingspaketet är inte giltig UTF-8",
                    ),
                )
            }
        }
    }

    fun saveBaseUrl(baseUrl: String): String {
        val normalized = BaseUrlNormalizer.normalize(baseUrl)
        return transaction { db ->
            val values = ContentValues().apply {
                put("base_url", normalized)
                put("updated_at_epoch_ms", System.currentTimeMillis())
            }
            if (db.update("station_configuration", values, "singleton_id = 1", emptyArray()) != 1) {
                fail(StationStoreErrors.STORAGE_FAILURE, "Serveradressen kunde inte lagras")
            }
            normalized
        }
    }

    fun loadBaseUrl(): String? = storageCall {
        database.readableDatabase.rawQuery(
            "SELECT base_url FROM station_configuration WHERE singleton_id = 1",
            emptyArray(),
        ).use { cursor ->
            if (!cursor.moveToFirst()) fail(StationStoreErrors.STORAGE_FAILURE, "Stationskonfigurationen saknas")
            if (cursor.isNull(0)) null else BaseUrlNormalizer.normalize(cursor.getString(0))
        }
    }

    fun getStatus(): StationStoreStatus = storageCall {
        val db = database.readableDatabase
        val identity = identity(db)
        val activePackages = mutableListOf<ActivePackageMetadata>()
        db.rawQuery(
            """
            SELECT active.race_id, active.package_version, package.payload_sha256, package.key_id
            FROM active_package active
            JOIN competition_package package
              ON package.race_id = active.race_id
             AND package.package_version = active.package_version
            ORDER BY active.race_id
            """.trimIndent(),
            emptyArray(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                activePackages += ActivePackageMetadata(
                    raceId = cursor.getString(0),
                    packageVersion = cursor.getInt(1),
                    payloadSha256 = cursor.getString(2),
                    keyId = cursor.getString(3),
                )
            }
        }
        val counts = outboxCounts(db)
        val latestEvaluation = db.rawQuery(
            """
            SELECT local_evaluation_json, evaluation_hash
            FROM local_evaluation
            ORDER BY local_sequence DESC
            LIMIT 1
            """.trimIndent(),
            emptyArray(),
        ).use { cursor ->
            if (!cursor.moveToFirst()) {
                null
            } else {
                val evaluationJson = cursor.getString(0)
                val evaluationHash = cursor.getString(1)
                if (Rs256Crypto.sha256Hex(evaluationJson.toByteArray(StandardCharsets.UTF_8)) != evaluationHash) {
                    fail(StationStoreErrors.HASH_MISMATCH, "Den senaste lokala bedömningens hash är ogiltig")
                }
                LatestLocalEvaluation(
                    localEvaluationJson = evaluationJson,
                    evaluationHash = evaluationHash,
                )
            }
        }
        StationStoreStatus(
            deviceId = identity.first,
            nextLocalSequence = identity.second,
            activePackages = activePackages,
            readoutCount = counts.readoutCount,
            pendingCount = counts.pendingCount,
            acknowledgedCount = counts.acknowledgedCount,
            rejectedCount = counts.rejectedCount,
            latestLocalEvaluation = latestEvaluation,
        )
    }

    fun loadLatestEvaluationPair(raceId: String): LatestEvaluationPair? {
        requireUuid(raceId, "raceId")
        return storageCall {
            val db = database.readableDatabase
            val event = db.rawQuery(
                """
                SELECT device_id, local_sequence, package_version, content_hash, state, rejection_reason
                FROM outbox_event
                WHERE race_id = ?
                ORDER BY local_sequence DESC
                LIMIT 1
                """.trimIndent(),
                arrayOf(raceId),
            ).use { cursor ->
                if (!cursor.moveToFirst()) {
                    null
                } else {
                    arrayOf<Any?>(
                        cursor.getString(0),
                        cursor.getInt(1),
                        cursor.getInt(2),
                        cursor.getString(3),
                        cursor.getString(4),
                        if (cursor.isNull(5)) null else cursor.getString(5),
                    )
                }
            } ?: return@storageCall null
            val deviceId = event[0] as String
            val localSequence = event[1] as Int
            val localEvaluation = db.rawQuery(
                """
                SELECT local_evaluation_json, evaluation_hash
                FROM local_evaluation
                WHERE device_id = ? AND local_sequence = ?
                """.trimIndent(),
                arrayOf(deviceId, localSequence.toString()),
            ).use { cursor ->
                if (!cursor.moveToFirst()) {
                    null
                } else {
                    val json = cursor.getString(0)
                    val hash = cursor.getString(1)
                    requireStoredHash(json, hash, "Den lokala bedömningens hash är ogiltig")
                    LatestLocalEvaluation(json, hash)
                }
            }
            val serverObservation = db.rawQuery(
                """
                SELECT observation_hash, event_acknowledgement_json, raw_message_id,
                       acknowledgement_status, rejection_reason, current_package_version,
                       package_version_status, package_update_required, server_result_json,
                       server_result_hash, evaluation_hash, observed_at_epoch_ms
                FROM server_ack_observation
                WHERE device_id = ? AND local_sequence = ?
                ORDER BY observed_at_epoch_ms DESC, acknowledgement_receipt_id DESC, observation_hash DESC
                LIMIT 1
                """.trimIndent(),
                arrayOf(deviceId, localSequence.toString()),
            ).use { cursor ->
                if (!cursor.moveToFirst()) {
                    null
                } else {
                    val observationHash = cursor.getString(0)
                    val eventJson = cursor.getString(1)
                    val currentPackageVersion = cursor.getInt(5)
                    val packageVersionStatus = cursor.getString(6)
                    val packageUpdateRequired = cursor.getInt(7) == 1
                    requireObservationHash(
                        eventJson,
                        currentPackageVersion,
                        packageVersionStatus,
                        packageUpdateRequired,
                        observationHash,
                    )
                    val serverResultJson = if (cursor.isNull(8)) null else cursor.getString(8)
                    val serverResultHash = if (cursor.isNull(9)) null else cursor.getString(9)
                    val evaluationHash = if (cursor.isNull(10)) null else cursor.getString(10)
                    if (serverResultJson != null && serverResultHash != null && evaluationHash != null) {
                        requireStoredHash(serverResultJson, serverResultHash, "Serverresultatets hash är ogiltig")
                    } else if (serverResultJson != null || serverResultHash != null || evaluationHash != null) {
                        fail(StationStoreErrors.STORAGE_FAILURE, "Serverresultatets lagrade fält är inkonsistenta")
                    }
                    ServerAckObservation(
                        observationHash = observationHash,
                        rawMessageId = if (cursor.isNull(2)) null else cursor.getString(2),
                        acknowledgementStatus = cursor.getString(3),
                        rejectionReason = if (cursor.isNull(4)) null else cursor.getString(4),
                        currentPackageVersion = currentPackageVersion,
                        packageVersionStatus = packageVersionStatus,
                        packageUpdateRequired = packageUpdateRequired,
                        serverResultJson = serverResultJson,
                        serverResultHash = serverResultHash,
                        evaluationHash = evaluationHash,
                        observedAtEpochMs = cursor.getLong(11),
                    )
                }
            }
            LatestEvaluationPair(
                deviceId = deviceId,
                localSequence = localSequence,
                raceId = raceId,
                packageVersion = event[2] as Int,
                contentHash = event[3] as String,
                outboxState = event[4] as String,
                rejectionReason = event[5] as String?,
                localEvaluation = localEvaluation,
                serverObservation = serverObservation,
            )
        }
    }

    fun enqueueEvent(request: EnqueueRequest): StoredOutboxEvent {
        validateEnqueueRequest(request)
        return transaction { db ->
            val activeVersion = activePackageVersion(db, request.raceId)
            if (activeVersion == null || activeVersion != request.packageVersion) {
                fail(
                    StationStoreErrors.NO_ACTIVE_PACKAGE,
                    "Händelsen matchar inte ett aktivt tävlingspaket",
                )
            }
            val (deviceId, localSequence) = identity(db)
            if (localSequence >= StationStoreLimits.MAX_SEQUENCE) {
                fail(StationStoreErrors.STORAGE_FAILURE, "Stationens lokala sekvensutrymme är slut")
            }
            val now = System.currentTimeMillis()
            val values = ContentValues().apply {
                put("device_id", deviceId)
                put("local_sequence", localSequence)
                put("session_id", request.sessionId)
                put("race_id", request.raceId)
                put("package_version", request.packageVersion)
                put("station_received_at", request.stationReceivedAt)
                put("transport", request.transport)
                put("payload_json", request.payloadJson)
                put("content_hash", request.contentHash)
                put("state", "PENDING")
                put("created_at_epoch_ms", now)
                put("updated_at_epoch_ms", now)
            }
            db.insertOrThrow("outbox_event", null, values)
            hooks.afterOutboxInsert.run()
            val sequenceValues = ContentValues().apply { put("next_local_sequence", localSequence + 1) }
            val updated = db.update(
                "station_identity",
                sequenceValues,
                "singleton_id = 1 AND next_local_sequence = ?",
                arrayOf(localSequence.toString()),
            )
            if (updated != 1) fail(StationStoreErrors.STORAGE_FAILURE, "Lokal sekvens kunde inte reserveras")

            StoredOutboxEvent(
                deviceId = deviceId,
                localSequence = localSequence,
                sessionId = request.sessionId,
                raceId = request.raceId,
                packageVersion = request.packageVersion,
                stationReceivedAt = request.stationReceivedAt,
                transport = request.transport,
                payloadJson = request.payloadJson,
                contentHash = request.contentHash,
            )
        }
    }

    fun listPending(limit: Int): List<StoredOutboxEvent> {
        if (limit !in 1..StationStoreLimits.MAX_PENDING_LIMIT) {
            fail(StationStoreErrors.INVALID_ARGUMENT, "limit är ogiltigt")
        }
        return storageCall {
            val events = mutableListOf<StoredOutboxEvent>()
            database.readableDatabase.rawQuery(
                """
                SELECT device_id, local_sequence, session_id, race_id, package_version,
                       station_received_at, transport, payload_json, content_hash
                FROM outbox_event
                WHERE state = 'PENDING'
                ORDER BY local_sequence
                LIMIT ?
                """.trimIndent(),
                arrayOf(limit.toString()),
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    events += StoredOutboxEvent(
                        deviceId = cursor.getString(0),
                        localSequence = cursor.getInt(1),
                        sessionId = cursor.getString(2),
                        raceId = cursor.getString(3),
                        packageVersion = cursor.getInt(4),
                        stationReceivedAt = cursor.getString(5),
                        transport = cursor.getString(6),
                        payloadJson = cursor.getString(7),
                        contentHash = cursor.getString(8),
                    )
                }
            }
            events
        }
    }

    fun recordLocalEvaluation(record: LocalEvaluationRecord): RecordedLocalEvaluation = transaction { db ->
        val (storedRaceId, storedPackageVersion) = db.rawQuery(
            """
            SELECT race_id, package_version
            FROM outbox_event
            WHERE device_id = ? AND local_sequence = ?
            """.trimIndent(),
            arrayOf(record.deviceId, record.localSequence.toString()),
        ).use { cursor ->
            if (!cursor.moveToFirst()) {
                fail(StationStoreErrors.EVALUATION_CONFLICT, "Bedömningen saknar en beständig outboxpost")
            }
            cursor.getString(0) to cursor.getInt(1)
        }
        if (storedRaceId != record.raceId || storedPackageVersion != record.packageVersion) {
            fail(StationStoreErrors.EVALUATION_CONFLICT, "Bedömningen matchar inte outboxens frysta kontext")
        }

        val packagePayload = db.rawQuery(
            """
            SELECT payload_sha256, payload_bytes
            FROM competition_package
            WHERE race_id = ? AND package_version = ?
            """.trimIndent(),
            arrayOf(record.raceId, record.packageVersion.toString()),
        ).use { cursor ->
            if (!cursor.moveToFirst()) {
                fail(StationStoreErrors.EVALUATION_CONFLICT, "Bedömningens tävlingspaket saknas")
            }
            cursor.getString(0) to cursor.getBlob(1).copyOf()
        }
        if (packagePayload.first != record.packagePayloadSha256 ||
            Rs256Crypto.sha256Hex(packagePayload.second) != record.packagePayloadSha256
        ) {
            fail(StationStoreErrors.EVALUATION_CONFLICT, "Bedömningen matchar inte tävlingspaketets hash")
        }
        val packageJson = try {
            JSONObject(
                StrictUtf8.decode(
                    packagePayload.second,
                    StationStoreErrors.EVALUATION_CONFLICT,
                    "Bedömningens tävlingspaket är inte giltig UTF-8",
                ),
            )
        } catch (failure: JSONException) {
            throw StationStoreFailure(
                StationStoreErrors.EVALUATION_CONFLICT,
                "Bedömningens tävlingspaket är inte giltig JSON",
                failure,
            )
        }
        if (packageJson.opt("resultEngineVersion") != record.engineVersion ||
            record.snapshotVersion != record.packageVersion
        ) {
            fail(StationStoreErrors.EVALUATION_CONFLICT, "Bedömningens motor- eller snapshotversion är ogiltig")
        }

        val existing = db.rawQuery(
            """
            SELECT local_evaluation_json, evaluation_hash
            FROM local_evaluation
            WHERE device_id = ? AND local_sequence = ?
            """.trimIndent(),
            arrayOf(record.deviceId, record.localSequence.toString()),
        ).use { cursor ->
            if (!cursor.moveToFirst()) null else cursor.getString(0) to cursor.getString(1)
        }
        if (existing != null) {
            if (existing.first != record.localEvaluationJson || existing.second != record.evaluationHash) {
                fail(StationStoreErrors.EVALUATION_CONFLICT, "Sekvensen har redan en annan lokal bedömning")
            }
            return@transaction RecordedLocalEvaluation(
                status = "duplicate",
                deviceId = record.deviceId,
                localSequence = record.localSequence,
                evaluationHash = record.evaluationHash,
            )
        }

        val values = ContentValues().apply {
            put("device_id", record.deviceId)
            put("local_sequence", record.localSequence)
            put("race_id", record.raceId)
            put("package_version", record.packageVersion)
            put("package_payload_sha256", record.packagePayloadSha256)
            put("engine_version", record.engineVersion)
            put("snapshot_version", record.snapshotVersion)
            put("local_evaluation_json", record.localEvaluationJson)
            put("evaluation_hash", record.evaluationHash)
            put("created_at_epoch_ms", System.currentTimeMillis())
        }
        db.insertOrThrow("local_evaluation", null, values)
        hooks.afterLocalEvaluationInsert.run()
        RecordedLocalEvaluation(
            status = "stored",
            deviceId = record.deviceId,
            localSequence = record.localSequence,
            evaluationHash = record.evaluationHash,
        )
    }

    fun applyAcknowledgements(parsed: ParsedAcknowledgement): AppliedAcknowledgements = transaction { db ->
        val identity = identity(db)
        if (parsed.deviceId != identity.first) {
            fail(StationStoreErrors.ACK_CONFLICT, "Kvittensen tillhör en annan station")
        }

        data class Transition(
            val command: AcknowledgementCommand,
            val currentState: String,
            val currentReason: String?,
            val observationExists: Boolean,
        )

        val transitions = parsed.commands.map { command ->
            db.rawQuery(
                """
                SELECT content_hash, state, rejection_reason
                FROM outbox_event
                WHERE device_id = ? AND local_sequence = ?
                """.trimIndent(),
                arrayOf(parsed.deviceId, command.localSequence.toString()),
            ).use { cursor ->
                if (!cursor.moveToFirst() || cursor.getString(0) != command.contentHash) {
                    fail(StationStoreErrors.ACK_CONFLICT, "Kvittensen matchar inte den frysta köposten")
                }
                val state = cursor.getString(1)
                val reason = if (cursor.isNull(2)) null else cursor.getString(2)
                when {
                    state == "PENDING" -> Unit
                    state == "ACKNOWLEDGED" && command.status in ACKNOWLEDGED_STATUSES -> Unit
                    state == "REJECTED" && command.status == "rejected" && reason == command.rejectionReason -> Unit
                    else -> fail(StationStoreErrors.ACK_CONFLICT, "Kvittensen motsäger tidigare stationsstatus")
                }
                if (command.rawMessageId != null) {
                    val existingRawMessageId = db.rawQuery(
                        """
                        SELECT raw_message_id
                        FROM server_ack_observation
                        WHERE device_id = ? AND local_sequence = ? AND raw_message_id IS NOT NULL
                        LIMIT 1
                        """.trimIndent(),
                        arrayOf(parsed.deviceId, command.localSequence.toString()),
                    ).use { observationCursor ->
                        if (observationCursor.moveToFirst()) observationCursor.getString(0) else null
                    }
                    if (existingRawMessageId != null && existingRawMessageId != command.rawMessageId) {
                        fail(StationStoreErrors.ACK_CONFLICT, "Kvittensen anger ett annat server-id för samma köpost")
                    }
                }
                val existingObservationJson = db.rawQuery(
                    """
                    SELECT event_acknowledgement_json
                    FROM server_ack_observation
                    WHERE device_id = ? AND local_sequence = ? AND observation_hash = ?
                    """.trimIndent(),
                    arrayOf(parsed.deviceId, command.localSequence.toString(), command.observationHash),
                ).use { observationCursor ->
                    if (observationCursor.moveToFirst()) observationCursor.getString(0) else null
                }
                if (existingObservationJson != null && existingObservationJson != command.eventAcknowledgementJson) {
                    fail(StationStoreErrors.ACK_CONFLICT, "Kvittensens observationshash har annat innehåll")
                }
                Transition(command, state, reason, existingObservationJson != null)
            }
        }

        val pendingTransitions = transitions.filter { it.currentState == "PENDING" }
        val newObservations = transitions.filterNot { it.observationExists }
        var acknowledgedCount = 0
        var rejectedCount = 0
        if (pendingTransitions.isNotEmpty() || newObservations.isNotEmpty()) {
            val now = System.currentTimeMillis()
            val receiptValues = ContentValues().apply {
                put("device_id", parsed.deviceId)
                put("acknowledgement_json", parsed.acknowledgementJson)
                put("received_at_epoch_ms", now)
            }
            val receiptId = db.insertOrThrow("acknowledgement_receipt", null, receiptValues)
            newObservations.forEach { transition ->
                val command = transition.command
                val result = command.serverResult
                val values = ContentValues().apply {
                    put("device_id", parsed.deviceId)
                    put("local_sequence", command.localSequence)
                    put("observation_hash", command.observationHash)
                    put("event_acknowledgement_json", command.eventAcknowledgementJson)
                    if (command.rawMessageId == null) putNull("raw_message_id") else put("raw_message_id", command.rawMessageId)
                    put("acknowledgement_status", command.status)
                    if (command.rejectionReason == null) putNull("rejection_reason")
                    else put("rejection_reason", command.rejectionReason)
                    put("current_package_version", command.currentPackageVersion)
                    put("package_version_status", command.packageVersionStatus)
                    put("package_update_required", if (command.packageUpdateRequired) 1 else 0)
                    if (result == null) {
                        putNull("server_result_json")
                        putNull("server_result_hash")
                        putNull("evaluation_hash")
                    } else {
                        put("server_result_json", result.serverResultJson)
                        put("server_result_hash", result.serverResultHash)
                        put("evaluation_hash", result.evaluationHash)
                    }
                    put("acknowledgement_receipt_id", receiptId)
                    put("observed_at_epoch_ms", now)
                }
                db.insertOrThrow("server_ack_observation", null, values)
                hooks.afterAcknowledgementObservationInsert.run()
            }
            pendingTransitions.forEach { transition ->
                val command = transition.command
                val acknowledged = command.status in ACKNOWLEDGED_STATUSES
                val values = ContentValues().apply {
                    put("state", if (acknowledged) "ACKNOWLEDGED" else "REJECTED")
                    put("acknowledgement_status", command.status)
                    if (command.rejectionReason == null) putNull("rejection_reason")
                    else put("rejection_reason", command.rejectionReason)
                    put("acknowledgement_receipt_id", receiptId)
                    put("updated_at_epoch_ms", now)
                }
                val updated = db.update(
                    "outbox_event",
                    values,
                    "device_id = ? AND local_sequence = ? AND state = 'PENDING' AND content_hash = ?",
                    arrayOf(parsed.deviceId, command.localSequence.toString(), command.contentHash),
                )
                if (updated != 1) fail(StationStoreErrors.ACK_CONFLICT, "Köposten ändrades under kvitteringen")
                if (acknowledged) acknowledgedCount += 1 else rejectedCount += 1
            }
            hooks.beforeAcknowledgementCommit.run()
        }
        AppliedAcknowledgements(
            acknowledgedCount = acknowledgedCount,
            rejectedCount = rejectedCount,
            unchangedCount = transitions.size - pendingTransitions.size,
            pendingCount = pendingCount(db),
        )
    }

    override fun close() {
        database.close()
    }

    private fun validateEnqueueRequest(request: EnqueueRequest) {
        requireUuid(request.raceId, "raceId")
        requireUuid(request.sessionId, "sessionId")
        if (request.packageVersion <= 0) fail(StationStoreErrors.INVALID_ARGUMENT, "packageVersion är ogiltigt")
        if (request.stationReceivedAt.isBlank() || request.stationReceivedAt.length > StationStoreLimits.MAX_TEXT_LENGTH) {
            fail(StationStoreErrors.INVALID_ARGUMENT, "stationReceivedAt är ogiltigt")
        }
        if (request.transport != "simulator") {
            fail(StationStoreErrors.INVALID_ARGUMENT, "transport måste vara simulator")
        }
        if (request.payloadJson.isEmpty() || request.payloadJson.length > StationStoreLimits.MAX_PAYLOAD_JSON_LENGTH) {
            fail(StationStoreErrors.INVALID_ARGUMENT, "payloadJson har ogiltig storlek")
        }
        validateSimulatorPayload(request.payloadJson)
        if (!SHA256_HEX.matches(request.contentHash)) {
            fail(StationStoreErrors.INVALID_ARGUMENT, "contentHash är ogiltigt")
        }
        val actualHash = Rs256Crypto.sha256Hex(request.payloadJson.toByteArray(StandardCharsets.UTF_8))
        if (actualHash != request.contentHash) {
            fail(StationStoreErrors.HASH_MISMATCH, "contentHash matchar inte payloadJson")
        }
    }

    private fun validateSimulatorPayload(payloadJson: String) {
        val payload = try {
            JSONObject(payloadJson)
        } catch (failure: JSONException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_ARGUMENT, "payloadJson är inte giltig JSON", failure)
        }
        val keys = payload.keys().asSequence().toSet()
        val required = setOf("cardNumber", "finishPunchedAt", "punches")
        if (keys != required && keys != required + "startPunchedAt") {
            fail(StationStoreErrors.INVALID_ARGUMENT, "payloadJson har ogiltiga fält")
        }
        requireText(payload, "cardNumber", 32)
        requireText(payload, "finishPunchedAt", StationStoreLimits.MAX_TEXT_LENGTH)
        if (payload.has("startPunchedAt")) requireText(payload, "startPunchedAt", StationStoreLimits.MAX_TEXT_LENGTH)
        val punches = payload.opt("punches") as? JSONArray
            ?: fail(StationStoreErrors.INVALID_ARGUMENT, "payloadJson.punches är ogiltigt")
        if (punches.length() > 256) fail(StationStoreErrors.INVALID_ARGUMENT, "payloadJson.punches är för stor")
        repeat(punches.length()) { index ->
            val punch = punches.opt(index) as? JSONObject
                ?: fail(StationStoreErrors.INVALID_ARGUMENT, "payloadJson.punches[$index] är ogiltigt")
            if (punch.keys().asSequence().toSet() != setOf("code", "punchedAt")) {
                fail(StationStoreErrors.INVALID_ARGUMENT, "payloadJson.punches[$index] har ogiltiga fält")
            }
            val code = punch.opt("code") as? Number
                ?: fail(StationStoreErrors.INVALID_ARGUMENT, "payloadJson.punches[$index].code är ogiltigt")
            if (code.toDouble() != code.toInt().toDouble() || code.toInt() <= 0) {
                fail(StationStoreErrors.INVALID_ARGUMENT, "payloadJson.punches[$index].code är ogiltigt")
            }
            requireText(punch, "punchedAt", StationStoreLimits.MAX_TEXT_LENGTH)
        }
    }

    private fun requireText(value: JSONObject, key: String, maxLength: Int): String {
        val text = value.opt(key) as? String
            ?: fail(StationStoreErrors.INVALID_ARGUMENT, "$key är ogiltigt")
        if (text.isBlank() || text.length > maxLength) {
            fail(StationStoreErrors.INVALID_ARGUMENT, "$key är ogiltigt")
        }
        return text
    }

    private fun requireUuid(value: String, key: String) {
        val parsed = try {
            UUID.fromString(value)
        } catch (failure: IllegalArgumentException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_ARGUMENT, "$key är ogiltigt", failure)
        }
        if (parsed.toString() != value) fail(StationStoreErrors.INVALID_ARGUMENT, "$key är inte en kanonisk UUID")
    }

    private fun installedPackageHash(db: SQLiteDatabase, raceId: String, packageVersion: Int): String? =
        db.rawQuery(
            "SELECT payload_sha256 FROM competition_package WHERE race_id = ? AND package_version = ?",
            arrayOf(raceId, packageVersion.toString()),
        ).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }

    private fun activePackageVersion(db: SQLiteDatabase, raceId: String): Int? =
        db.rawQuery(
            "SELECT package_version FROM active_package WHERE race_id = ?",
            arrayOf(raceId),
        ).use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) else null }

    private fun identity(db: SQLiteDatabase): Pair<String, Int> =
        db.rawQuery(
            "SELECT device_id, next_local_sequence FROM station_identity WHERE singleton_id = 1",
            emptyArray(),
        ).use { cursor ->
            if (!cursor.moveToFirst()) fail(StationStoreErrors.STORAGE_FAILURE, "Stationsidentiteten saknas")
            cursor.getString(0) to cursor.getInt(1)
        }

    private fun pendingCount(db: SQLiteDatabase): Int =
        db.rawQuery("SELECT count(*) FROM outbox_event WHERE state = 'PENDING'", emptyArray()).use { cursor ->
            cursor.moveToFirst()
            cursor.getInt(0)
        }

    private fun requireStoredHash(value: String, expectedHash: String, message: String) {
        if (Rs256Crypto.sha256Hex(value.toByteArray(StandardCharsets.UTF_8)) != expectedHash) {
            fail(StationStoreErrors.HASH_MISMATCH, message)
        }
    }

    private fun requireObservationHash(
        eventAcknowledgementJson: String,
        currentPackageVersion: Int,
        packageVersionStatus: String,
        packageUpdateRequired: Boolean,
        expectedHash: String,
    ) {
        val bytes = try {
            CanonicalJson.encode(
                JSONObject()
                    .put("currentPackageVersion", currentPackageVersion)
                    .put("packageVersionStatus", packageVersionStatus)
                    .put("packageUpdateRequired", packageUpdateRequired)
                    .put("acknowledgement", JSONObject(eventAcknowledgementJson)),
            )
        } catch (failure: JSONException) {
            throw StationStoreFailure(
                StationStoreErrors.HASH_MISMATCH,
                "Serverkvittensens observationsinnehåll är ogiltigt",
                failure,
            )
        } catch (failure: StationStoreFailure) {
            throw StationStoreFailure(
                StationStoreErrors.HASH_MISMATCH,
                "Serverkvittensens observationsinnehåll är ogiltigt",
                failure,
            )
        }
        if (Rs256Crypto.sha256Hex(bytes) != expectedHash) {
            fail(StationStoreErrors.HASH_MISMATCH, "Serverkvittensens observationshash är ogiltig")
        }
    }

    private data class OutboxCounts(
        val readoutCount: Int,
        val pendingCount: Int,
        val acknowledgedCount: Int,
        val rejectedCount: Int,
    )

    private fun outboxCounts(db: SQLiteDatabase): OutboxCounts = db.rawQuery(
        """
        SELECT count(*),
               count(CASE WHEN state = 'PENDING' THEN 1 END),
               count(CASE WHEN state = 'ACKNOWLEDGED' THEN 1 END),
               count(CASE WHEN state = 'REJECTED' THEN 1 END)
        FROM outbox_event
        """.trimIndent(),
        emptyArray(),
    ).use { cursor ->
        cursor.moveToFirst()
        OutboxCounts(
            readoutCount = cursor.getInt(0),
            pendingCount = cursor.getInt(1),
            acknowledgedCount = cursor.getInt(2),
            rejectedCount = cursor.getInt(3),
        )
    }

    private inline fun <T> transaction(block: (SQLiteDatabase) -> T): T = storageCall {
        val db = database.writableDatabase
        db.beginTransaction()
        try {
            val result = block(db)
            db.setTransactionSuccessful()
            result
        } finally {
            db.endTransaction()
        }
    }

    private inline fun <T> storageCall(block: () -> T): T = try {
        block()
    } catch (failure: StationStoreFailure) {
        throw failure
    } catch (failure: SQLiteException) {
        throw StationStoreFailure(
            StationStoreErrors.STORAGE_FAILURE,
            "Stationsdatabasen kunde inte slutföra operationen",
            failure,
        )
    }

    private fun fail(code: String, message: String): Nothing = throw StationStoreFailure(code, message)

    private val SHA256_HEX = Regex("^[a-f0-9]{64}$")
    private val ACKNOWLEDGED_STATUSES = setOf("stored", "duplicate")
}

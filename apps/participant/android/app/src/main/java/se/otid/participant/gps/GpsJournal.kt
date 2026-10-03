package se.otid.participant.gps

import android.content.ContentValues
import android.content.Context
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteOpenHelper
import java.io.DataOutputStream
import java.io.OutputStream
import java.security.DigestOutputStream
import java.security.MessageDigest
import java.util.UUID

enum class GpsRecordingState {
    RECORDING,
    INTERRUPTED,
    STOPPED,
}

data class GpsSnapshot(
    val id: String,
    val state: GpsRecordingState,
    val pointCount: Int,
    val lastMeasuredAtMs: Long?,
    val hash: String?,
)

internal data class GpsJournalPoint(
    val sequence: Long,
    val segmentNumber: Int,
    val measuredAtMs: Long,
    val latitude: Double,
    val longitude: Double,
    val accuracyM: Float?,
    val elapsedRealtimeNanos: Long,
)

/** Stable binary encoding used to freeze a local point journal. */
internal object GpsJournalEncoding {
    fun sha256(recordingId: String, points: List<GpsJournalPoint>): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val discard = object : OutputStream() {
            override fun write(value: Int) = Unit
            override fun write(buffer: ByteArray, offset: Int, length: Int) = Unit
        }
        DataOutputStream(DigestOutputStream(discard, digest)).use { output ->
            output.writeInt(1)
            output.writeUTF(recordingId)
            output.writeInt(points.size)
            points.forEach { point ->
                output.writeLong(point.sequence)
                output.writeInt(point.segmentNumber)
                output.writeLong(point.measuredAtMs)
                output.writeLong(canonicalZero(point.latitude).toBits())
                output.writeLong(canonicalZero(point.longitude).toBits())
                output.writeBoolean(point.accuracyM != null)
                point.accuracyM?.let { output.writeInt(canonicalZero(it).toBits()) }
                output.writeLong(point.elapsedRealtimeNanos)
            }
        }
        return digest.digest().toHex()
    }

    private fun canonicalZero(value: Double): Double = if (value == 0.0) 0.0 else value
    private fun canonicalZero(value: Float): Float = if (value == 0f) 0f else value
    private fun ByteArray.toHex(): String = buildString(size * 2) {
        val digits = "0123456789abcdef"
        for (byte in this@toHex) {
            val value = byte.toInt() and 0xff
            append(digits[value ushr 4])
            append(digits[value and 0x0f])
        }
    }
}

class GpsJournalFailure(
    val code: String,
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

/** App-private, append-only journal for one participant device. */
class GpsJournal(
    context: Context,
    dbName: String = DATABASE_NAME,
    private val maxPointsPerRecording: Int = MAX_POINTS_PER_RECORDING,
) : AutoCloseable {
    private val database = GpsJournalDatabase(context.applicationContext, dbName)

    init {
        require(dbName.isNotBlank()) { "Databasnamn saknas" }
        require(maxPointsPerRecording in 1..MAX_POINTS_PER_RECORDING) {
            "Punktgränsen måste vara mellan 1 och $MAX_POINTS_PER_RECORDING"
        }
    }

    fun start(nowMs: Long): GpsSnapshot = transaction { db ->
        requireTimestamp(nowMs)
        val active = db.rawQuery(
            "SELECT 1 FROM gps_recording WHERE state IN ('RECORDING', 'INTERRUPTED') LIMIT 1",
            emptyArray(),
        ).use { it.moveToFirst() }
        if (active) fail(INVALID_STATE, "En tidigare inspelning måste stoppas innan en ny startas")

        val id = UUID.randomUUID().toString()
        val startOrder = db.rawQuery(
            "SELECT COALESCE(MAX(start_order), 0) + 1 FROM gps_recording",
            emptyArray(),
        ).use { cursor ->
            cursor.moveToFirst()
            cursor.getLong(0)
        }
        val recording = ContentValues().apply {
            put("recording_id", id)
            put("start_order", startOrder)
            put("state", GpsRecordingState.RECORDING.name)
            put("started_at_ms", nowMs)
            put("next_sequence", 1L)
            put("point_count", 0)
            put("segment_number", 1)
        }
        db.insertOrThrow("gps_recording", null, recording)
        appendTransition(db, id, "STARTED", nowMs, 1)
        snapshot(db, id)
    }

    fun append(
        id: String,
        measuredAtMs: Long,
        latitude: Double,
        longitude: Double,
        accuracyM: Float?,
        elapsedRealtimeNanos: Long,
    ): GpsSnapshot = transaction { db ->
        requireRecordingId(id)
        requireTimestamp(measuredAtMs)
        require(latitude.isFinite() && latitude in -90.0..90.0) { "Ogiltig latitud" }
        require(longitude.isFinite() && longitude in -180.0..180.0) { "Ogiltig longitud" }
        require(accuracyM == null || (accuracyM.isFinite() && accuracyM >= 0f)) {
            "Ogiltig noggrannhet"
        }
        require(elapsedRealtimeNanos >= 0L) { "Ogiltig monoton mättid" }

        val current = recording(db, id) ?: fail(NOT_FOUND, "Inspelningen finns inte")
        if (current.state != GpsRecordingState.RECORDING) {
            fail(INVALID_STATE, "Inspelningen tar inte emot mätpunkter")
        }
        if (current.pointCount >= maxPointsPerRecording) {
            fail(POINT_LIMIT, "Inspelningens lokala punktgräns är nådd")
        }

        val sequence = current.nextSequence
        val point = ContentValues().apply {
            put("recording_id", id)
            put("sequence", sequence)
            put("segment_number", current.segmentNumber)
            put("measured_at_ms", measuredAtMs)
            put("latitude", canonicalZero(latitude))
            put("longitude", canonicalZero(longitude))
            if (accuracyM == null) putNull("accuracy_m") else put("accuracy_m", canonicalZero(accuracyM))
            put("elapsed_realtime_nanos", elapsedRealtimeNanos)
        }
        db.insertOrThrow("gps_point", null, point)

        val updated = ContentValues().apply {
            put("next_sequence", sequence + 1L)
            put("point_count", current.pointCount + 1)
        }
        if (db.update(
                "gps_recording",
                updated,
                "recording_id = ? AND state = 'RECORDING' AND next_sequence = ?",
                arrayOf(id, sequence.toString()),
            ) != 1
        ) {
            fail(INVALID_STATE, "Inspelningen ändrades under punktlagringen")
        }
        snapshot(db, id)
    }

    /** Marks the currently open recording as interrupted after service/process loss. */
    fun interruptOpen(nowMs: Long): GpsSnapshot? = transaction { db ->
        requireTimestamp(nowMs)
        val id = db.rawQuery(
            "SELECT recording_id FROM gps_recording WHERE state = 'RECORDING' ORDER BY start_order DESC LIMIT 1",
            emptyArray(),
        ).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
            ?: return@transaction null
        val current = recording(db, id) ?: fail(NOT_FOUND, "Inspelningen finns inte")
        val values = ContentValues().apply { put("state", GpsRecordingState.INTERRUPTED.name) }
        if (db.update("gps_recording", values, "recording_id = ? AND state = 'RECORDING'", arrayOf(id)) != 1) {
            fail(INVALID_STATE, "Inspelningen kunde inte markeras avbruten")
        }
        appendTransition(db, id, "INTERRUPTED", nowMs, current.segmentNumber)
        snapshot(db, id)
    }

    /** Explicitly resumes an interrupted recording in a new segment. */
    fun resume(id: String, nowMs: Long): GpsSnapshot = transaction { db ->
        requireRecordingId(id)
        requireTimestamp(nowMs)
        val current = recording(db, id) ?: fail(NOT_FOUND, "Inspelningen finns inte")
        if (current.state != GpsRecordingState.INTERRUPTED) {
            fail(INVALID_STATE, "Endast en avbruten inspelning kan fortsätta")
        }
        if (db.rawQuery("SELECT 1 FROM gps_recording WHERE state = 'RECORDING' LIMIT 1", emptyArray())
                .use { it.moveToFirst() }
        ) {
            fail(INVALID_STATE, "En annan inspelning pågår redan")
        }
        val segment = current.segmentNumber + 1
        val values = ContentValues().apply {
            put("state", GpsRecordingState.RECORDING.name)
            put("segment_number", segment)
        }
        if (db.update("gps_recording", values, "recording_id = ? AND state = 'INTERRUPTED'", arrayOf(id)) != 1) {
            fail(INVALID_STATE, "Inspelningen kunde inte fortsätta")
        }
        appendTransition(db, id, "RESUMED", nowMs, segment)
        snapshot(db, id)
    }

    /** Freezes the point journal. Stopping an interrupted recording is supported. */
    fun stop(id: String, nowMs: Long): GpsSnapshot = transaction { db ->
        requireRecordingId(id)
        requireTimestamp(nowMs)
        val current = recording(db, id) ?: fail(NOT_FOUND, "Inspelningen finns inte")
        if (current.state == GpsRecordingState.STOPPED) return@transaction snapshot(db, id)
        if (current.state !in setOf(GpsRecordingState.RECORDING, GpsRecordingState.INTERRUPTED)) {
            fail(INVALID_STATE, "Inspelningen kan inte stoppas")
        }

        val hash = pointJournalHash(db, id, current.pointCount)
        val values = ContentValues().apply {
            put("state", GpsRecordingState.STOPPED.name)
            put("stopped_at_ms", nowMs)
            put("frozen_hash", hash)
        }
        if (db.update(
                "gps_recording",
                values,
                "recording_id = ? AND state IN ('RECORDING', 'INTERRUPTED')",
                arrayOf(id),
            ) != 1
        ) {
            fail(INVALID_STATE, "Inspelningen kunde inte frysas")
        }
        appendTransition(db, id, "STOPPED", nowMs, current.segmentNumber)
        snapshot(db, id)
    }

    fun latest(): GpsSnapshot? = storageCall {
        database.readableDatabase.rawQuery(
            "SELECT recording_id FROM gps_recording ORDER BY start_order DESC LIMIT 1",
            emptyArray(),
        ).use { cursor ->
            if (cursor.moveToFirst()) snapshot(database.readableDatabase, cursor.getString(0)) else null
        }
    }

    override fun close() = database.close()

    private fun appendTransition(db: SQLiteDatabase, id: String, kind: String, atMs: Long, segment: Int) {
        val values = ContentValues().apply {
            put("recording_id", id)
            put("transition_number", nextTransitionNumber(db, id))
            put("kind", kind)
            put("occurred_at_ms", atMs)
            put("segment_number", segment)
        }
        db.insertOrThrow("gps_transition", null, values)
    }

    private fun nextTransitionNumber(db: SQLiteDatabase, id: String): Long =
        db.rawQuery(
            "SELECT COALESCE(MAX(transition_number), 0) + 1 FROM gps_transition WHERE recording_id = ?",
            arrayOf(id),
        ).use { cursor ->
            cursor.moveToFirst()
            cursor.getLong(0)
        }

    private fun recording(db: SQLiteDatabase, id: String): Recording? =
        db.rawQuery(
            "SELECT state, next_sequence, point_count, segment_number, frozen_hash FROM gps_recording WHERE recording_id = ?",
            arrayOf(id),
        ).use { cursor ->
            if (!cursor.moveToFirst()) null else Recording(
                state = GpsRecordingState.valueOf(cursor.getString(0)),
                nextSequence = cursor.getLong(1),
                pointCount = cursor.getInt(2),
                segmentNumber = cursor.getInt(3),
                frozenHash = if (cursor.isNull(4)) null else cursor.getString(4),
            )
        }

    private fun snapshot(db: SQLiteDatabase, id: String): GpsSnapshot {
        val current = recording(db, id) ?: fail(NOT_FOUND, "Inspelningen finns inte")
        val lastMeasuredAtMs = db.rawQuery(
            "SELECT measured_at_ms FROM gps_point WHERE recording_id = ? ORDER BY sequence DESC LIMIT 1",
            arrayOf(id),
        ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else null }
        return GpsSnapshot(id, current.state, current.pointCount, lastMeasuredAtMs, current.frozenHash)
    }

    private fun pointJournalHash(db: SQLiteDatabase, id: String, pointCount: Int): String {
        val points = mutableListOf<GpsJournalPoint>()
        db.rawQuery(
            "SELECT sequence, segment_number, measured_at_ms, latitude, longitude, accuracy_m, elapsed_realtime_nanos FROM gps_point WHERE recording_id = ? ORDER BY sequence ASC",
            arrayOf(id),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                points += GpsJournalPoint(
                    sequence = cursor.getLong(0),
                    segmentNumber = cursor.getInt(1),
                    measuredAtMs = cursor.getLong(2),
                    latitude = cursor.getDouble(3),
                    longitude = cursor.getDouble(4),
                    accuracyM = if (cursor.isNull(5)) null else cursor.getFloat(5),
                    elapsedRealtimeNanos = cursor.getLong(6),
                )
            }
        }
        if (points.size != pointCount) fail(STORAGE_FAILURE, "Punktjournalens antal stämmer inte")
        return GpsJournalEncoding.sha256(id, points)
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
    } catch (failure: GpsJournalFailure) {
        throw failure
    } catch (failure: SQLiteException) {
        throw GpsJournalFailure(STORAGE_FAILURE, "GPS-journalen kunde inte lagra data", failure)
    }

    private fun requireRecordingId(id: String) {
        if (!UUID_PATTERN.matches(id)) fail(INVALID_ID, "Ogiltigt lokalt inspelnings-id")
    }

    private fun requireTimestamp(value: Long) {
        require(value >= 0L) { "Mättiden måste vara ett icke-negativt epochvärde" }
    }

    private fun fail(code: String, message: String): Nothing = throw GpsJournalFailure(code, message)

    private data class Recording(
        val state: GpsRecordingState,
        val nextSequence: Long,
        val pointCount: Int,
        val segmentNumber: Int,
        val frozenHash: String?,
    )

    companion object {
        const val DATABASE_NAME = "otid-participant-gps.db"
        const val MAX_POINTS_PER_RECORDING = 100_000

        const val INVALID_ID = "INVALID_ID"
        const val NOT_FOUND = "NOT_FOUND"
        const val INVALID_STATE = "INVALID_STATE"
        const val POINT_LIMIT = "POINT_LIMIT"
        const val STORAGE_FAILURE = "STORAGE_FAILURE"

        private val UUID_PATTERN = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

        private fun canonicalZero(value: Double): Double = if (value == 0.0) 0.0 else value
        private fun canonicalZero(value: Float): Float = if (value == 0f) 0f else value
    }
}

private class GpsJournalDatabase(context: Context, name: String) :
    SQLiteOpenHelper(context, name, null, VERSION, PRESERVE_CORRUPT_DATABASE)
{
    init {
        setWriteAheadLoggingEnabled(true)
    }

    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        db.setForeignKeyConstraintsEnabled(true)
        db.execSQL("PRAGMA synchronous=FULL")
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE gps_recording (
                recording_id TEXT PRIMARY KEY NOT NULL,
                start_order INTEGER NOT NULL UNIQUE CHECK (start_order > 0),
                state TEXT NOT NULL CHECK (state IN ('RECORDING', 'INTERRUPTED', 'STOPPED')),
                started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
                stopped_at_ms INTEGER NULL CHECK (stopped_at_ms IS NULL OR stopped_at_ms >= 0),
                next_sequence INTEGER NOT NULL CHECK (next_sequence >= 1),
                point_count INTEGER NOT NULL CHECK (point_count BETWEEN 0 AND ${GpsJournal.MAX_POINTS_PER_RECORDING}),
                segment_number INTEGER NOT NULL CHECK (segment_number >= 1),
                frozen_hash TEXT NULL CHECK (frozen_hash IS NULL OR (length(frozen_hash) = 64 AND frozen_hash NOT GLOB '*[^0-9a-f]*')),
                CHECK (next_sequence = point_count + 1),
                CHECK (
                    (state = 'STOPPED' AND stopped_at_ms IS NOT NULL AND frozen_hash IS NOT NULL)
                    OR (state <> 'STOPPED' AND stopped_at_ms IS NULL AND frozen_hash IS NULL)
                )
            ) WITHOUT ROWID
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE gps_point (
                recording_id TEXT NOT NULL,
                sequence INTEGER NOT NULL CHECK (sequence > 0),
                segment_number INTEGER NOT NULL CHECK (segment_number >= 1),
                measured_at_ms INTEGER NOT NULL CHECK (measured_at_ms >= 0),
                latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
                longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
                accuracy_m REAL NULL CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
                elapsed_realtime_nanos INTEGER NOT NULL CHECK (elapsed_realtime_nanos >= 0),
                PRIMARY KEY (recording_id, sequence),
                FOREIGN KEY (recording_id) REFERENCES gps_recording(recording_id)
            ) WITHOUT ROWID
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE gps_transition (
                recording_id TEXT NOT NULL,
                transition_number INTEGER NOT NULL CHECK (transition_number > 0),
                kind TEXT NOT NULL CHECK (kind IN ('STARTED', 'INTERRUPTED', 'RESUMED', 'STOPPED')),
                occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms >= 0),
                segment_number INTEGER NOT NULL CHECK (segment_number >= 1),
                PRIMARY KEY (recording_id, transition_number),
                FOREIGN KEY (recording_id) REFERENCES gps_recording(recording_id)
            ) WITHOUT ROWID
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER gps_point_no_update BEFORE UPDATE ON gps_point
            BEGIN SELECT RAISE(ABORT, 'GPS points are immutable'); END
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER gps_point_no_delete BEFORE DELETE ON gps_point
            BEGIN SELECT RAISE(ABORT, 'GPS points are append-only'); END
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER gps_transition_no_update BEFORE UPDATE ON gps_transition
            BEGIN SELECT RAISE(ABORT, 'GPS transitions are immutable'); END
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER gps_transition_no_delete BEFORE DELETE ON gps_transition
            BEGIN SELECT RAISE(ABORT, 'GPS transitions are append-only'); END
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        throw SQLiteException("Unsupported GPS journal migration $oldVersion -> $newVersion")
    }

    override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        throw SQLiteException("GPS journal downgrade is not supported")
    }

    companion object {
        private const val VERSION = 1

        private val PRESERVE_CORRUPT_DATABASE = DatabaseErrorHandler { _ ->
            throw SQLiteDatabaseCorruptException("Corrupt GPS journal is preserved for recovery")
        }
    }
}

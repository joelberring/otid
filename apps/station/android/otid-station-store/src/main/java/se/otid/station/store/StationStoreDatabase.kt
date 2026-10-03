package se.otid.station.store

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.UUID

class StationStoreDatabase(
    context: Context,
    databaseName: String = DATABASE_NAME,
    private val targetVersion: Int = DATABASE_VERSION,
) : SQLiteOpenHelper(context.applicationContext, databaseName, null, targetVersion) {
    init {
        require(targetVersion in 1..DATABASE_VERSION) { "Ogiltig testdatabasversion" }
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
            CREATE TABLE station_identity (
                singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
                device_id TEXT NOT NULL UNIQUE,
                next_local_sequence INTEGER NOT NULL CHECK (next_local_sequence BETWEEN 1 AND ${StationStoreLimits.MAX_SEQUENCE}),
                created_at_epoch_ms INTEGER NOT NULL
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE competition_package (
                race_id TEXT NOT NULL,
                package_version INTEGER NOT NULL CHECK (package_version > 0),
                payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
                key_id TEXT NOT NULL CHECK (length(key_id) = 64),
                envelope_json TEXT NOT NULL,
                payload_bytes BLOB NOT NULL,
                installed_at_epoch_ms INTEGER NOT NULL,
                PRIMARY KEY (race_id, package_version)
            ) WITHOUT ROWID
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE active_package (
                race_id TEXT PRIMARY KEY,
                package_version INTEGER NOT NULL,
                FOREIGN KEY (race_id, package_version)
                    REFERENCES competition_package(race_id, package_version)
            ) WITHOUT ROWID
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE acknowledgement_receipt (
                receipt_id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                acknowledgement_json TEXT NOT NULL,
                received_at_epoch_ms INTEGER NOT NULL
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE outbox_event (
                device_id TEXT NOT NULL,
                local_sequence INTEGER NOT NULL CHECK (local_sequence > 0),
                session_id TEXT NOT NULL,
                race_id TEXT NOT NULL,
                package_version INTEGER NOT NULL CHECK (package_version > 0),
                station_received_at TEXT NOT NULL,
                transport TEXT NOT NULL CHECK (transport = 'simulator'),
                payload_json TEXT NOT NULL,
                content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
                state TEXT NOT NULL CHECK (state IN ('PENDING', 'ACKNOWLEDGED', 'REJECTED')),
                acknowledgement_status TEXT NULL CHECK (acknowledgement_status IN ('stored', 'duplicate', 'rejected')),
                rejection_reason TEXT NULL,
                acknowledgement_receipt_id INTEGER NULL,
                created_at_epoch_ms INTEGER NOT NULL,
                updated_at_epoch_ms INTEGER NOT NULL,
                PRIMARY KEY (device_id, local_sequence),
                FOREIGN KEY (race_id, package_version)
                    REFERENCES competition_package(race_id, package_version),
                FOREIGN KEY (acknowledgement_receipt_id)
                    REFERENCES acknowledgement_receipt(receipt_id),
                CHECK (
                    (state = 'PENDING' AND acknowledgement_status IS NULL AND rejection_reason IS NULL AND acknowledgement_receipt_id IS NULL)
                    OR (state = 'ACKNOWLEDGED' AND acknowledgement_status IN ('stored', 'duplicate') AND rejection_reason IS NULL AND acknowledgement_receipt_id IS NOT NULL)
                    OR (state = 'REJECTED' AND acknowledgement_status = 'rejected' AND rejection_reason IS NOT NULL AND acknowledgement_receipt_id IS NOT NULL)
                )
            ) WITHOUT ROWID
            """.trimIndent(),
        )
        db.execSQL("CREATE INDEX outbox_pending_sequence_idx ON outbox_event(state, local_sequence)")
        db.execSQL(
            """
            CREATE TRIGGER competition_package_no_update
            BEFORE UPDATE ON competition_package
            BEGIN
                SELECT RAISE(ABORT, 'competition packages are immutable');
            END
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER competition_package_no_delete
            BEFORE DELETE ON competition_package
            BEGIN
                SELECT RAISE(ABORT, 'competition packages are append-only');
            END
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER acknowledgement_receipt_no_update
            BEFORE UPDATE ON acknowledgement_receipt
            BEGIN
                SELECT RAISE(ABORT, 'acknowledgement receipts are immutable');
            END
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER acknowledgement_receipt_no_delete
            BEFORE DELETE ON acknowledgement_receipt
            BEGIN
                SELECT RAISE(ABORT, 'acknowledgement receipts are append-only');
            END
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER outbox_event_no_delete
            BEFORE DELETE ON outbox_event
            BEGIN
                SELECT RAISE(ABORT, 'outbox events are append-only');
            END
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER outbox_event_immutable_fields
            BEFORE UPDATE ON outbox_event
            WHEN OLD.device_id IS NOT NEW.device_id
              OR OLD.local_sequence IS NOT NEW.local_sequence
              OR OLD.session_id IS NOT NEW.session_id
              OR OLD.race_id IS NOT NEW.race_id
              OR OLD.package_version IS NOT NEW.package_version
              OR OLD.station_received_at IS NOT NEW.station_received_at
              OR OLD.transport IS NOT NEW.transport
              OR OLD.payload_json IS NOT NEW.payload_json
              OR OLD.content_hash IS NOT NEW.content_hash
              OR OLD.created_at_epoch_ms IS NOT NEW.created_at_epoch_ms
              OR OLD.state <> 'PENDING'
              OR NEW.state NOT IN ('ACKNOWLEDGED', 'REJECTED')
            BEGIN
                SELECT RAISE(ABORT, 'outbox event mutation is not allowed');
            END
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER station_identity_guard
            BEFORE UPDATE ON station_identity
            WHEN OLD.device_id IS NOT NEW.device_id
              OR NEW.next_local_sequence <> OLD.next_local_sequence + 1
              OR OLD.created_at_epoch_ms IS NOT NEW.created_at_epoch_ms
            BEGIN
                SELECT RAISE(ABORT, 'station identity mutation is not allowed');
            END
            """.trimIndent(),
        )
        db.execSQL(
            "INSERT INTO station_identity(singleton_id, device_id, next_local_sequence, created_at_epoch_ms) VALUES (1, ?, 1, ?)",
            arrayOf<Any>(UUID.randomUUID().toString(), System.currentTimeMillis()),
        )
        if (targetVersion >= 2) createLocalEvaluationSchema(db)
        if (targetVersion >= 3) createServerAcknowledgementSchema(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        var migratedVersion = oldVersion
        if (migratedVersion == 1 && newVersion >= 2) {
            createLocalEvaluationSchema(db)
            migratedVersion = 2
        }
        if (migratedVersion == 2 && newVersion >= 3) {
            createServerAcknowledgementSchema(db)
            migratedVersion = 3
        }
        if (migratedVersion != newVersion) throw unsupportedMigration(oldVersion, newVersion)
    }

    override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        throw StationStoreFailure(
            StationStoreErrors.STORAGE_FAILURE,
            "Stationsdatabasen får inte nedgraderas från version $oldVersion till $newVersion",
        )
    }

    private fun createLocalEvaluationSchema(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE local_evaluation (
                device_id TEXT NOT NULL,
                local_sequence INTEGER NOT NULL CHECK (local_sequence > 0),
                race_id TEXT NOT NULL,
                package_version INTEGER NOT NULL CHECK (package_version > 0),
                package_payload_sha256 TEXT NOT NULL CHECK (length(package_payload_sha256) = 64),
                engine_version TEXT NOT NULL CHECK (length(engine_version) BETWEEN 1 AND 64),
                snapshot_version INTEGER NOT NULL CHECK (snapshot_version > 0),
                local_evaluation_json TEXT NOT NULL,
                evaluation_hash TEXT NOT NULL CHECK (length(evaluation_hash) = 64),
                created_at_epoch_ms INTEGER NOT NULL,
                PRIMARY KEY (device_id, local_sequence),
                FOREIGN KEY (device_id, local_sequence)
                    REFERENCES outbox_event(device_id, local_sequence),
                FOREIGN KEY (race_id, package_version)
                    REFERENCES competition_package(race_id, package_version)
            ) WITHOUT ROWID
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER local_evaluation_no_update
            BEFORE UPDATE ON local_evaluation
            BEGIN
                SELECT RAISE(ABORT, 'local evaluations are immutable');
            END
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER local_evaluation_no_delete
            BEFORE DELETE ON local_evaluation
            BEGIN
                SELECT RAISE(ABORT, 'local evaluations are append-only');
            END
            """.trimIndent(),
        )
    }

    private fun createServerAcknowledgementSchema(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE station_configuration (
                singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
                base_url TEXT NULL CHECK (base_url IS NULL OR length(base_url) BETWEEN 1 AND ${StationStoreLimits.MAX_BASE_URL_LENGTH}),
                updated_at_epoch_ms INTEGER NULL,
                CHECK (
                    (base_url IS NULL AND updated_at_epoch_ms IS NULL)
                    OR (base_url IS NOT NULL AND updated_at_epoch_ms IS NOT NULL)
                )
            )
            """.trimIndent(),
        )
        db.execSQL("INSERT INTO station_configuration(singleton_id) VALUES (1)")
        db.execSQL(
            """
            CREATE TABLE server_ack_observation (
                device_id TEXT NOT NULL,
                local_sequence INTEGER NOT NULL CHECK (local_sequence > 0),
                observation_hash TEXT NOT NULL CHECK (length(observation_hash) = 64),
                event_acknowledgement_json TEXT NOT NULL,
                raw_message_id TEXT NULL,
                acknowledgement_status TEXT NOT NULL CHECK (acknowledgement_status IN ('stored', 'duplicate', 'rejected')),
                rejection_reason TEXT NULL,
                current_package_version INTEGER NOT NULL CHECK (current_package_version > 0),
                package_version_status TEXT NOT NULL CHECK (package_version_status IN ('current', 'stale', 'ahead')),
                package_update_required INTEGER NOT NULL CHECK (package_update_required IN (0, 1)),
                server_result_json TEXT NULL,
                server_result_hash TEXT NULL CHECK (server_result_hash IS NULL OR length(server_result_hash) = 64),
                evaluation_hash TEXT NULL CHECK (evaluation_hash IS NULL OR length(evaluation_hash) = 64),
                acknowledgement_receipt_id INTEGER NOT NULL,
                observed_at_epoch_ms INTEGER NOT NULL,
                PRIMARY KEY (device_id, local_sequence, observation_hash),
                FOREIGN KEY (device_id, local_sequence)
                    REFERENCES outbox_event(device_id, local_sequence),
                FOREIGN KEY (acknowledgement_receipt_id)
                    REFERENCES acknowledgement_receipt(receipt_id),
                CHECK (package_update_required = CASE package_version_status WHEN 'stale' THEN 1 ELSE 0 END),
                CHECK (
                    (
                        acknowledgement_status IN ('stored', 'duplicate')
                        AND raw_message_id IS NOT NULL
                        AND rejection_reason IS NULL
                        AND (
                            (server_result_json IS NULL AND server_result_hash IS NULL AND evaluation_hash IS NULL)
                            OR (server_result_json IS NOT NULL AND server_result_hash IS NOT NULL AND evaluation_hash IS NOT NULL)
                        )
                    )
                    OR (
                        acknowledgement_status = 'rejected'
                        AND raw_message_id IS NULL
                        AND rejection_reason IS NOT NULL
                        AND server_result_json IS NULL
                        AND server_result_hash IS NULL
                        AND evaluation_hash IS NULL
                    )
                )
            ) WITHOUT ROWID
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX server_ack_observation_latest_idx ON server_ack_observation(device_id, local_sequence, observed_at_epoch_ms, acknowledgement_receipt_id)",
        )
        db.execSQL(
            """
            CREATE TRIGGER server_ack_observation_no_update
            BEFORE UPDATE ON server_ack_observation
            BEGIN
                SELECT RAISE(ABORT, 'server acknowledgement observations are immutable');
            END
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER server_ack_observation_no_delete
            BEFORE DELETE ON server_ack_observation
            BEGIN
                SELECT RAISE(ABORT, 'server acknowledgement observations are append-only');
            END
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER station_configuration_guard
            BEFORE UPDATE ON station_configuration
            WHEN OLD.singleton_id IS NOT NEW.singleton_id
            BEGIN
                SELECT RAISE(ABORT, 'station configuration identity is immutable');
            END
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TRIGGER station_configuration_no_delete
            BEFORE DELETE ON station_configuration
            BEGIN
                SELECT RAISE(ABORT, 'station configuration cannot be deleted');
            END
            """.trimIndent(),
        )
    }

    private fun unsupportedMigration(oldVersion: Int, newVersion: Int) = StationStoreFailure(
        StationStoreErrors.STORAGE_FAILURE,
        "Stationsdatabasen saknar en säker migration från version $oldVersion till $newVersion",
    )

    companion object {
        const val DATABASE_NAME = "otid-station.db"
        const val DATABASE_VERSION = 3
    }
}

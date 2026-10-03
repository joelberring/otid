package se.otid.station.store

data class VerifiedCompetitionPackage(
    val raceId: String,
    val packageVersion: Int,
    val payloadSha256: String,
    val keyId: String,
    val envelopeJson: String,
    val payloadBytes: ByteArray,
)

data class InstalledPackageMetadata(
    val status: String,
    val raceId: String,
    val packageVersion: Int,
    val payloadSha256: String,
    val keyId: String,
)

data class ActivePackageMetadata(
    val raceId: String,
    val packageVersion: Int,
    val payloadSha256: String,
    val keyId: String,
)

data class LoadedActivePackage(
    val raceId: String,
    val packageVersion: Int,
    val payloadSha256: String,
    val keyId: String,
    val payloadJson: String,
)

data class LatestLocalEvaluation(
    val localEvaluationJson: String,
    val evaluationHash: String,
)

data class StationStoreStatus(
    val deviceId: String,
    val nextLocalSequence: Int,
    val activePackages: List<ActivePackageMetadata>,
    val readoutCount: Int,
    val pendingCount: Int,
    val acknowledgedCount: Int,
    val rejectedCount: Int,
    val latestLocalEvaluation: LatestLocalEvaluation?,
)

data class EnqueueRequest(
    val raceId: String,
    val sessionId: String,
    val packageVersion: Int,
    val stationReceivedAt: String,
    val transport: String,
    val payloadJson: String,
    val contentHash: String,
)

data class StoredOutboxEvent(
    val deviceId: String,
    val localSequence: Int,
    val sessionId: String,
    val raceId: String,
    val packageVersion: Int,
    val stationReceivedAt: String,
    val transport: String,
    val payloadJson: String,
    val contentHash: String,
)

data class LocalEvaluationRecord(
    val deviceId: String,
    val localSequence: Int,
    val raceId: String,
    val packageVersion: Int,
    val packagePayloadSha256: String,
    val engineVersion: String,
    val snapshotVersion: Int,
    val localEvaluationJson: String,
    val evaluationHash: String,
)

data class ParsedServerResult(
    val serverResultJson: String,
    val serverResultHash: String,
    val evaluationHash: String,
)

data class ServerAckObservation(
    val observationHash: String,
    val rawMessageId: String?,
    val acknowledgementStatus: String,
    val rejectionReason: String?,
    val currentPackageVersion: Int,
    val packageVersionStatus: String,
    val packageUpdateRequired: Boolean,
    val serverResultJson: String?,
    val serverResultHash: String?,
    val evaluationHash: String?,
    val observedAtEpochMs: Long,
)

data class LatestEvaluationPair(
    val deviceId: String,
    val localSequence: Int,
    val raceId: String,
    val packageVersion: Int,
    val contentHash: String,
    val outboxState: String,
    val rejectionReason: String?,
    val localEvaluation: LatestLocalEvaluation?,
    val serverObservation: ServerAckObservation?,
)

data class RecordedLocalEvaluation(
    val status: String,
    val deviceId: String,
    val localSequence: Int,
    val evaluationHash: String,
)

data class AcknowledgementCommand(
    val localSequence: Int,
    val contentHash: String,
    val status: String,
    val rawMessageId: String?,
    val rejectionReason: String?,
    val currentPackageVersion: Int,
    val packageVersionStatus: String,
    val packageUpdateRequired: Boolean,
    val eventAcknowledgementJson: String,
    val observationHash: String,
    val serverResult: ParsedServerResult?,
)

data class ParsedAcknowledgement(
    val deviceId: String,
    val acknowledgementJson: String,
    val commands: List<AcknowledgementCommand>,
)

data class AppliedAcknowledgements(
    val acknowledgedCount: Int,
    val rejectedCount: Int,
    val unchangedCount: Int,
    val pendingCount: Int,
)

class StationStoreFailure(
    val code: String,
    override val message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

fun interface StationStoreFailureHook {
    fun run()
}

data class StationStoreHooks(
    val afterPackageInsert: StationStoreFailureHook = StationStoreFailureHook {},
    val afterOutboxInsert: StationStoreFailureHook = StationStoreFailureHook {},
    val afterLocalEvaluationInsert: StationStoreFailureHook = StationStoreFailureHook {},
    val afterAcknowledgementObservationInsert: StationStoreFailureHook = StationStoreFailureHook {},
    val beforeAcknowledgementCommit: StationStoreFailureHook = StationStoreFailureHook {},
)

object StationStoreErrors {
    const val INVALID_ARGUMENT = "STATION_STORE_INVALID_ARGUMENT"
    const val INVALID_ENVELOPE = "STATION_STORE_INVALID_ENVELOPE"
    const val UNTRUSTED_KEY = "STATION_STORE_UNTRUSTED_KEY"
    const val INVALID_SIGNATURE = "STATION_STORE_INVALID_SIGNATURE"
    const val INVALID_PACKAGE = "STATION_STORE_INVALID_PACKAGE"
    const val PACKAGE_ROLLBACK = "STATION_STORE_PACKAGE_ROLLBACK"
    const val PACKAGE_VERSION_CONFLICT = "STATION_STORE_PACKAGE_VERSION_CONFLICT"
    const val NO_ACTIVE_PACKAGE = "STATION_STORE_NO_ACTIVE_PACKAGE"
    const val HASH_MISMATCH = "STATION_STORE_HASH_MISMATCH"
    const val ACK_CONFLICT = "STATION_STORE_ACK_CONFLICT"
    const val EVALUATION_CONFLICT = "STATION_STORE_EVALUATION_CONFLICT"
    const val STORAGE_FAILURE = "STATION_STORE_STORAGE_FAILURE"
    const val INVALID_CREDENTIAL = "STATION_STORE_INVALID_CREDENTIAL"
    const val CREDENTIAL_REQUIRED = "STATION_STORE_CREDENTIAL_REQUIRED"
    const val CREDENTIAL_STORAGE = "STATION_STORE_CREDENTIAL_STORAGE"
    const val AUTHORIZED_REQUEST = "STATION_STORE_AUTHORIZED_REQUEST"
    const val INVALID_PAIRING = "STATION_STORE_INVALID_PAIRING"
    const val PAIRING_REQUIRED = "STATION_STORE_PAIRING_REQUIRED"
    const val PAIRING_REQUEST = "STATION_STORE_PAIRING_REQUEST"
    const val PAIRING_UNAUTHORIZED = "STATION_STORE_PAIRING_UNAUTHORIZED"
    const val PAIRING_CONFLICT = "STATION_STORE_PAIRING_CONFLICT"
    const val PAIRING_RATE_LIMITED = "STATION_STORE_PAIRING_RATE_LIMITED"
    const val INTERNAL = "STATION_STORE_INTERNAL"
}

object StationStoreLimits {
    const val MAX_ENVELOPE_LENGTH = 11 * 1024 * 1024
    const val MAX_ENVELOPE_PAYLOAD_LENGTH = 8 * 1024 * 1024
    const val MAX_PAYLOAD_JSON_LENGTH = 256 * 1024
    const val MAX_ACKNOWLEDGEMENT_LENGTH = 512 * 1024
    const val MAX_LOCAL_EVALUATION_LENGTH = 512 * 1024
    const val MAX_BASE_URL_LENGTH = 2 * 1024
    const val MAX_TEXT_LENGTH = 512
    const val MAX_PENDING_LIMIT = 100
    const val MAX_SEQUENCE = Int.MAX_VALUE
}

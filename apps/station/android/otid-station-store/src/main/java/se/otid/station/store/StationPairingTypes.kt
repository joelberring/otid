package se.otid.station.store

data class StationPairingAttemptMetadata(
    val attemptId: String,
    val deviceId: String,
    val startedAtEpochMs: Long,
)

sealed interface StationPairingStatus {
    data object None : StationPairingStatus
    data object Invalid : StationPairingStatus
    data class Pending(val attempt: StationPairingAttemptMetadata) : StationPairingStatus
    data class Completed(
        val attemptId: String,
        val credential: StationCredentialMetadata,
    ) : StationPairingStatus
}

data class StationPairingRedeemResult(
    val status: String,
    val credential: StationCredentialMetadata,
)

internal sealed interface StationPairingRecord {
    val formatVersion: Int
    val deviceId: String

    data class Empty(
        override val formatVersion: Int = 1,
        override val deviceId: String,
        val clearedAtEpochMs: Long,
    ) : StationPairingRecord

    data class Pending(
        override val formatVersion: Int = 1,
        override val deviceId: String,
        val attemptId: String,
        val baseUrl: String,
        val grantToken: String,
        val grantFingerprint: String,
        val credentialSecret: ByteArray,
        val startedAtEpochMs: Long,
    ) : StationPairingRecord

    data class Completed(
        override val formatVersion: Int = 1,
        override val deviceId: String,
        val attemptId: String,
        val baseUrl: String,
        val grantFingerprint: String,
        val credential: StationCredentialMetadata,
        val completedAtEpochMs: Long,
    ) : StationPairingRecord
}

internal data class StationPairingRedeemRequest(
    val formatVersion: Int,
    val attemptId: String,
    val deviceId: String,
    val credentialSecretHash: String,
)

internal data class StationPairingServerResponse(
    val formatVersion: Int,
    val attemptId: String,
    val credential: StationCredentialMetadata,
)

internal object StationPairingLimits {
    const val MAX_GRANT_LENGTH = 128
    const val MAX_PAIRING_PLAINTEXT_BYTES = 8 * 1024
    const val MAX_PAIRING_ENVELOPE_BYTES = 16 * 1024
    const val MAX_RESPONSE_BYTES = 8 * 1024
}

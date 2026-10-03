package se.otid.station.store

data class StationCredential(
    val formatVersion: Int,
    val token: String,
    val credentialId: String,
    val deviceId: String,
    val raceId: String,
    val scope: String,
    val generation: Int,
    val issuedAt: String,
    val expiresAt: String,
)

data class StationCredentialMetadata(
    val credentialId: String,
    val deviceId: String,
    val raceId: String,
    val scope: String,
    val generation: Int,
    val issuedAt: String,
    val expiresAt: String,
)

sealed interface StationCredentialStatus {
    data object Missing : StationCredentialStatus
    data object Invalid : StationCredentialStatus
    data class Active(val credential: StationCredentialMetadata) : StationCredentialStatus
    data class Expired(val credential: StationCredentialMetadata) : StationCredentialStatus
}

data class EncryptedCredential(
    val initializationVector: ByteArray,
    val ciphertext: ByteArray,
)

data class AuthorizedStationRequest(
    val baseUrl: String,
    val raceId: String,
    val resource: String,
    val method: String,
    val bodyJson: String?,
    val idempotencyKey: String?,
    val connectTimeoutMs: Int,
    val readTimeoutMs: Int,
)

data class AuthorizedStationResponse(
    val status: Int,
    val headers: Map<String, String>,
    val data: String,
    val url: String,
)

fun StationCredential.metadata() = StationCredentialMetadata(
    credentialId = credentialId,
    deviceId = deviceId,
    raceId = raceId,
    scope = scope,
    generation = generation,
    issuedAt = issuedAt,
    expiresAt = expiresAt,
)

object StationCredentialLimits {
    const val MAX_CREDENTIAL_JSON_BYTES = 8 * 1024
    const val MAX_ENCRYPTED_ENVELOPE_BYTES = 16 * 1024
    const val MAX_REQUEST_BODY_BYTES = 512 * 1024
    const val MAX_ACK_RESPONSE_BYTES = 512 * 1024
    const val MAX_PACKAGE_RESPONSE_BYTES = 11 * 1024 * 1024
    const val MIN_TIMEOUT_MS = 1_000
    const val MAX_CONNECT_TIMEOUT_MS = 30_000
    const val MAX_READ_TIMEOUT_MS = 60_000
}

package se.otid.station.store

internal class StationPairingCoordinator(
    private val pairingVault: StationPairingVault,
    private val credentialVault: StationCredentialVault,
    private val httpClient: StationPairingHttpClient,
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
) {
    fun begin(baseUrl: String, grantToken: String, deviceId: String): StationPairingStatus =
        pairingVault.begin(baseUrl, grantToken, deviceId)

    fun status(deviceId: String): StationPairingStatus = pairingVault.status(deviceId)

    fun redeem(
        attemptId: String,
        deviceId: String,
        configuredBaseUrl: String,
        connectTimeoutMs: Int,
        readTimeoutMs: Int,
    ): StationPairingRedeemResult {
        val pending = try {
            pairingVault.pending(attemptId, deviceId, configuredBaseUrl)
        } catch (completed: StationPairingVault.PairingAlreadyCompleted) {
            val active = credentialVault.status(deviceId)
            val metadata = when (active) {
                is StationCredentialStatus.Active -> active.credential
                is StationCredentialStatus.Expired -> active.credential
                else -> throw StationStoreFailure(
                    StationStoreErrors.CREDENTIAL_REQUIRED,
                    "Completed-markören saknar en läsbar installerad credential",
                )
            }
            if (metadata != completed.completed.credential) {
                throw StationStoreFailure(StationStoreErrors.PAIRING_CONFLICT, "Completed-markören matchar inte credentialvalvet")
            }
            return StationPairingRedeemResult("already-installed", metadata)
        }
        try {
            val response = httpClient.redeem(pending, connectTimeoutMs, readTimeoutMs)
            StationPairingPolicy.validateServerResponse(response, pending, nowEpochMs())
            val credential = StationPairingPolicy.credentialFrom(response, pending.credentialSecret)
            val installed = credentialVault.install(credential, deviceId)
            pairingVault.complete(pending, installed)
            return StationPairingRedeemResult("installed", installed)
        } finally {
            pending.credentialSecret.fill(0)
        }
    }

    fun discard(expectedAttemptId: String, deviceId: String): StationPairingStatus =
        pairingVault.discard(expectedAttemptId, deviceId)

    fun discardInvalid(confirmDeviceId: String, deviceId: String): StationPairingStatus =
        pairingVault.discardInvalid(confirmDeviceId, deviceId)
}

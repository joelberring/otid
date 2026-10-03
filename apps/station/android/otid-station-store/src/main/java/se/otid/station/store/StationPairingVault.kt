package se.otid.station.store

import android.content.Context
import java.nio.charset.StandardCharsets
import java.util.UUID

internal class StationPairingVault(
    private val packageName: String,
    private val cipher: CredentialCipher,
    private val fileStore: CredentialFileStore,
    private val secretSource: PairingSecretSource = SecurePairingSecretSource(),
    private val attemptIdSource: () -> String = { UUID.randomUUID().toString() },
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
) {
    constructor(context: Context) : this(
        packageName = context.packageName,
        cipher = AndroidKeystoreCredentialCipher(),
        fileStore = AtomicCredentialFileStore(context, PAIRING_FILE_NAME),
    )

    fun begin(baseUrl: String, grantToken: String, deviceId: String): StationPairingStatus {
        StationPairingPolicy.requireUuid(deviceId, "device-id")
        val normalizedBaseUrl = StationPairingPolicy.normalizePairingUrl(baseUrl)
        val parsedGrant = StationPairingPolicy.parseGrant(grantToken)
        parsedGrant.secret.fill(0)
        val fingerprint = StationPairingPolicy.grantFingerprint(grantToken)
        val existing = loadRecordOrNull(deviceId)
        when (existing) {
            is StationPairingRecord.Pending -> {
                try {
                    if (existing.deviceId == deviceId && existing.baseUrl == normalizedBaseUrl &&
                        existing.grantFingerprint == fingerprint && existing.grantToken == grantToken
                    ) {
                        return existing.status()
                    }
                    throw StationStoreFailure(
                        StationStoreErrors.PAIRING_CONFLICT,
                        "Ett annat parningsförsök väntar; återuppta eller kasta det först",
                    )
                } finally {
                    existing.credentialSecret.fill(0)
                }
            }
            is StationPairingRecord.Completed -> {
                if (existing.deviceId == deviceId && existing.baseUrl == normalizedBaseUrl &&
                    existing.grantFingerprint == fingerprint
                ) {
                    return existing.status()
                }
            }
            is StationPairingRecord.Empty, null -> Unit
        }
        val secret = secretSource.nextSecret()
        try {
            StationPairingPolicy.validateGeneratedSecret(secret)
            val pending = StationPairingRecord.Pending(
                deviceId = deviceId,
                attemptId = attemptIdSource().also { StationPairingPolicy.requireUuid(it, "attempt-id") },
                baseUrl = normalizedBaseUrl,
                grantToken = grantToken,
                grantFingerprint = fingerprint,
                credentialSecret = secret,
                startedAtEpochMs = nowEpochMs(),
            )
            storeRecord(pending)
            return pending.status()
        } finally {
            secret.fill(0)
        }
    }

    fun status(deviceId: String): StationPairingStatus {
        if (!fileStore.exists()) return StationPairingStatus.None
        val record = try {
            loadRecord(deviceId)
        } catch (_: Exception) {
            return StationPairingStatus.Invalid
        }
        return try {
            record.status()
        } finally {
            if (record is StationPairingRecord.Pending) record.credentialSecret.fill(0)
        }
    }

    fun pending(attemptId: String, deviceId: String, configuredBaseUrl: String): StationPairingRecord.Pending {
        val record = loadRecord(deviceId)
        if (record is StationPairingRecord.Completed && record.attemptId == attemptId) {
            throw PairingAlreadyCompleted(record)
        }
        val pending = record as? StationPairingRecord.Pending
            ?: throw StationStoreFailure(StationStoreErrors.PAIRING_REQUIRED, "Inget parningsförsök väntar")
        try {
            StationPairingPolicy.requirePendingMatches(pending, attemptId, deviceId, configuredBaseUrl)
            return pending
        } catch (failure: Exception) {
            pending.credentialSecret.fill(0)
            throw failure
        }
    }

    fun complete(pending: StationPairingRecord.Pending, credential: StationCredentialMetadata) {
        val current = loadRecord(pending.deviceId)
        try {
            if (current !is StationPairingRecord.Pending || current.attemptId != pending.attemptId ||
                current.grantFingerprint != pending.grantFingerprint ||
                !Rs256Crypto.equal(current.credentialSecret, pending.credentialSecret)
            ) {
                throw StationStoreFailure(StationStoreErrors.PAIRING_CONFLICT, "Parningstillståndet ändrades under inlösen")
            }
            storeRecord(
                StationPairingRecord.Completed(
                    deviceId = pending.deviceId,
                    attemptId = pending.attemptId,
                    baseUrl = pending.baseUrl,
                    grantFingerprint = pending.grantFingerprint,
                    credential = credential,
                    completedAtEpochMs = nowEpochMs(),
                ),
            )
        } finally {
            if (current is StationPairingRecord.Pending) current.credentialSecret.fill(0)
        }
    }

    fun discard(expectedAttemptId: String, deviceId: String): StationPairingStatus {
        StationPairingPolicy.requireUuid(expectedAttemptId, "expected attempt-id")
        val record = loadRecord(deviceId)
        try {
            val actualAttemptId = when (record) {
                is StationPairingRecord.Pending -> record.attemptId
                is StationPairingRecord.Completed -> record.attemptId
                is StationPairingRecord.Empty -> return StationPairingStatus.None
            }
            if (actualAttemptId != expectedAttemptId) {
                throw StationStoreFailure(StationStoreErrors.PAIRING_CONFLICT, "Parningsförsöket matchar inte")
            }
            storeRecord(StationPairingRecord.Empty(deviceId = deviceId, clearedAtEpochMs = nowEpochMs()))
            return StationPairingStatus.None
        } finally {
            if (record is StationPairingRecord.Pending) record.credentialSecret.fill(0)
        }
    }

    fun discardInvalid(confirmDeviceId: String, deviceId: String): StationPairingStatus {
        if (confirmDeviceId != deviceId) {
            throw StationStoreFailure(StationStoreErrors.PAIRING_CONFLICT, "Enhetsbekräftelsen matchar inte")
        }
        if (!fileStore.exists() || status(deviceId) != StationPairingStatus.Invalid) {
            throw StationStoreFailure(StationStoreErrors.PAIRING_CONFLICT, "Det finns inget oläsbart parningstillstånd")
        }
        storeRecord(StationPairingRecord.Empty(deviceId = deviceId, clearedAtEpochMs = nowEpochMs()))
        return StationPairingStatus.None
    }

    private fun loadRecordOrNull(deviceId: String): StationPairingRecord? {
        if (!fileStore.exists()) return null
        return try {
            loadRecord(deviceId)
        } catch (failure: Exception) {
            throw StationStoreFailure(
                StationStoreErrors.INVALID_PAIRING,
                "Parningstillståndet är oläsbart och måste rensas uttryckligen",
                failure,
            )
        }
    }

    private fun loadRecord(deviceId: String): StationPairingRecord {
        val encrypted = CredentialEnvelopeCodec.decode(fileStore.read())
        val plaintext = cipher.decrypt(encrypted, associatedData(deviceId))
        try {
            val record = StationPairingCodec.decode(plaintext)
            if (record.deviceId != deviceId) {
                if (record is StationPairingRecord.Pending) record.credentialSecret.fill(0)
                throw StationStoreFailure(StationStoreErrors.INVALID_PAIRING, "Parningstillståndet tillhör en annan station")
            }
            return record
        } finally {
            plaintext.fill(0)
        }
    }

    private fun storeRecord(record: StationPairingRecord) {
        val plaintext = StationPairingCodec.encode(record)
        try {
            val encrypted = cipher.encrypt(plaintext, associatedData(record.deviceId))
            fileStore.write(CredentialEnvelopeCodec.encode(encrypted))
        } finally {
            plaintext.fill(0)
        }
    }

    private fun StationPairingRecord.status(): StationPairingStatus = when (this) {
        is StationPairingRecord.Empty -> StationPairingStatus.None
        is StationPairingRecord.Pending -> StationPairingStatus.Pending(
            StationPairingAttemptMetadata(attemptId, deviceId, startedAtEpochMs),
        )
        is StationPairingRecord.Completed -> StationPairingStatus.Completed(attemptId, credential)
    }

    private fun associatedData(deviceId: String): ByteArray =
        "otid-station-pairing-v1\u0000$packageName\u0000$deviceId".toByteArray(StandardCharsets.UTF_8)

    internal class PairingAlreadyCompleted(val completed: StationPairingRecord.Completed) : RuntimeException()

    companion object {
        internal const val PAIRING_FILE_NAME = "station-device-pairing.v1"
    }
}

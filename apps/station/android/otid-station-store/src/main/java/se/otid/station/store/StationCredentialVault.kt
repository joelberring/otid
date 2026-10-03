package se.otid.station.store

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface CredentialCipher {
    fun encrypt(plaintext: ByteArray, associatedData: ByteArray): EncryptedCredential
    fun decrypt(encrypted: EncryptedCredential, associatedData: ByteArray): ByteArray
}

interface CredentialFileStore {
    fun exists(): Boolean
    fun read(): ByteArray
    fun write(bytes: ByteArray)
}

data class CredentialFileHooks(
    val beforeFinishWrite: StationStoreFailureHook = StationStoreFailureHook {},
)

class AndroidKeystoreCredentialCipher(
    private val keyAlias: String = KEY_ALIAS,
) : CredentialCipher {
    override fun encrypt(plaintext: ByteArray, associatedData: ByteArray): EncryptedCredential = securityCall {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, loadOrCreateKey())
        cipher.updateAAD(associatedData)
        EncryptedCredential(cipher.iv.copyOf(), cipher.doFinal(plaintext))
    }

    override fun decrypt(encrypted: EncryptedCredential, associatedData: ByteArray): ByteArray = securityCall {
        val keyStore = keyStore()
        val key = keyStore.getKey(keyAlias, null) as? SecretKey
            ?: throw StationStoreFailure(StationStoreErrors.CREDENTIAL_STORAGE, "Credentialnyckeln saknas")
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, encrypted.initializationVector))
        cipher.updateAAD(associatedData)
        cipher.doFinal(encrypted.ciphertext)
    }

    private fun loadOrCreateKey(): SecretKey {
        val existing = keyStore().getKey(keyAlias, null) as? SecretKey
        if (existing != null) return existing
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setKeySize(256)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .setUserAuthenticationRequired(false)
                    .build(),
            )
            generateKey()
        }
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    private inline fun <T> securityCall(block: () -> T): T = try {
        block()
    } catch (failure: StationStoreFailure) {
        throw failure
    } catch (failure: GeneralSecurityException) {
        throw StationStoreFailure(StationStoreErrors.CREDENTIAL_STORAGE, "Credentialkryptot misslyckades", failure)
    } catch (failure: IOException) {
        throw StationStoreFailure(StationStoreErrors.CREDENTIAL_STORAGE, "Credentialnyckeln kunde inte läsas", failure)
    }

    companion object {
        internal const val KEY_ALIAS = "se.otid.station.device-credential.aes.v1"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}

class AtomicCredentialFileStore(
    context: Context,
    fileName: String = FILE_NAME,
    private val hooks: CredentialFileHooks = CredentialFileHooks(),
) : CredentialFileStore {
    internal val file = File(context.noBackupFilesDir, fileName)
    private val atomicFile = AtomicFile(file)

    @Synchronized
    override fun exists(): Boolean = file.exists()

    @Synchronized
    override fun read(): ByteArray {
        try {
            atomicFile.openRead().use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > StationCredentialLimits.MAX_ENCRYPTED_ENVELOPE_BYTES) {
                        throw StationStoreFailure(StationStoreErrors.CREDENTIAL_STORAGE, "Credentialkuvertet är för stort")
                    }
                    output.write(buffer, 0, count)
                }
                return output.toByteArray()
            }
        } catch (failure: StationStoreFailure) {
            throw failure
        } catch (failure: IOException) {
            throw StationStoreFailure(StationStoreErrors.CREDENTIAL_STORAGE, "Credentialkuvertet kunde inte läsas", failure)
        }
    }

    @Synchronized
    override fun write(bytes: ByteArray) {
        if (bytes.isEmpty() || bytes.size > StationCredentialLimits.MAX_ENCRYPTED_ENVELOPE_BYTES) {
            throw StationStoreFailure(StationStoreErrors.CREDENTIAL_STORAGE, "Credentialkuvertet har ogiltig storlek")
        }
        var output: java.io.FileOutputStream? = null
        try {
            output = atomicFile.startWrite()
            output.write(bytes)
            hooks.beforeFinishWrite.run()
            atomicFile.finishWrite(output)
            output = null
        } catch (failure: Throwable) {
            output?.let(atomicFile::failWrite)
            if (failure is StationStoreFailure) throw failure
            if (failure is IOException) {
                throw StationStoreFailure(StationStoreErrors.CREDENTIAL_STORAGE, "Credentialkuvertet kunde inte skrivas", failure)
            }
            throw failure
        }
    }

    companion object {
        internal const val FILE_NAME = "station-device-credential.v1"
    }
}

class StationCredentialVault(
    private val packageName: String,
    private val cipher: CredentialCipher,
    private val fileStore: CredentialFileStore,
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
) {
    constructor(context: Context) : this(
        packageName = context.packageName,
        cipher = AndroidKeystoreCredentialCipher(),
        fileStore = AtomicCredentialFileStore(context),
    )

    internal fun install(credentialJson: String, expectedDeviceId: String): StationCredentialMetadata =
        install(StationCredentialParser.parse(credentialJson), expectedDeviceId)

    internal fun install(credential: StationCredential, expectedDeviceId: String): StationCredentialMetadata {
        val current = loadCredentialOrNull(expectedDeviceId)
        StationCredentialPolicy.requireInstallable(credential, expectedDeviceId, current, nowEpochMs())
        if (credential == current) return credential.metadata()
        val plaintext = StationCredentialParser.encode(credential)
        try {
            val encrypted = cipher.encrypt(plaintext, associatedData(expectedDeviceId))
            fileStore.write(CredentialEnvelopeCodec.encode(encrypted))
        } finally {
            plaintext.fill(0)
        }
        return credential.metadata()
    }

    fun status(expectedDeviceId: String): StationCredentialStatus {
        if (!fileStore.exists()) return StationCredentialStatus.Missing
        val credential = try {
            loadCredential(expectedDeviceId)
        } catch (_: Exception) {
            return StationCredentialStatus.Invalid
        }
        return if (StationCredentialPolicy.isExpired(credential, nowEpochMs())) {
            StationCredentialStatus.Expired(credential.metadata())
        } else {
            StationCredentialStatus.Active(credential.metadata())
        }
    }

    fun requireActive(expectedDeviceId: String, expectedRaceId: String): StationCredential {
        val credential = when (val status = status(expectedDeviceId)) {
            is StationCredentialStatus.Active -> loadCredential(expectedDeviceId)
            else -> throw StationStoreFailure(
                StationStoreErrors.CREDENTIAL_REQUIRED,
                when (status) {
                    StationCredentialStatus.Missing -> "Stationscredential saknas"
                    StationCredentialStatus.Invalid -> "Stationscredential är ogiltig"
                    is StationCredentialStatus.Expired -> "Stationscredential har gått ut"
                    is StationCredentialStatus.Active -> "Stationscredential krävs"
                },
            )
        }
        if (credential.raceId != expectedRaceId || credential.scope != StationCredentialPolicy.READOUT_SCOPE) {
            throw StationStoreFailure(StationStoreErrors.CREDENTIAL_REQUIRED, "Stationscredential saknar rätt lopp- eller funktionsscope")
        }
        return credential
    }

    private fun loadCredentialOrNull(expectedDeviceId: String): StationCredential? = try {
        if (fileStore.exists()) loadCredential(expectedDeviceId) else null
    } catch (_: Exception) {
        null
    }

    private fun loadCredential(expectedDeviceId: String): StationCredential {
        val encrypted = CredentialEnvelopeCodec.decode(fileStore.read())
        val plaintext = cipher.decrypt(encrypted, associatedData(expectedDeviceId))
        try {
            val credential = StationCredentialParser.parse(String(plaintext, StandardCharsets.UTF_8))
            if (credential.deviceId != expectedDeviceId) {
                throw StationStoreFailure(StationStoreErrors.INVALID_CREDENTIAL, "Credentialen tillhör en annan station")
            }
            return credential
        } finally {
            plaintext.fill(0)
        }
    }

    private fun associatedData(deviceId: String): ByteArray =
        "otid-station-credential-v1\u0000$packageName\u0000$deviceId".toByteArray(StandardCharsets.UTF_8)
}

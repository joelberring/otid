package se.otid.station.store

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

@CapacitorPlugin(name = "OtidStationStore")
class OtidStationStorePlugin : Plugin() {
    private lateinit var store: StationStore
    private lateinit var credentialVault: StationCredentialVault
    private lateinit var authorizedHttpClient: AuthorizedStationHttpClient
    private lateinit var pairingCoordinator: StationPairingCoordinator
    private lateinit var executor: ExecutorService

    override fun load() {
        store = StationStore(StationStoreDatabase(context))
        credentialVault = StationCredentialVault(context)
        authorizedHttpClient = AuthorizedStationHttpClient()
        pairingCoordinator = StationPairingCoordinator(
            StationPairingVault(context),
            credentialVault,
            StationPairingHttpClient(),
        )
        executor = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "otid-station-store").apply { isDaemon = true }
        }
    }

    @PluginMethod
    fun installPackage(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, setOf("envelopeJson", "trustedPublicKeySpkiBase64"), "installPackage")
        val envelopeJson = call.requireText("envelopeJson", StationStoreLimits.MAX_ENVELOPE_LENGTH)
        val trustedKey = call.requireText("trustedPublicKeySpkiBase64", 16 * 1024)
        execute(call) {
            val verified = SignedPackageVerifier.verify(envelopeJson, trustedKey)
            store.installPackage(verified).toJsObject()
        }
    }

    @PluginMethod
    fun loadActivePackage(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, setOf("raceId"), "loadActivePackage")
        val raceId = call.requireText("raceId", 36)
        execute(call) { store.loadActivePackage(raceId).toJsObject() }
    }

    @PluginMethod
    fun getStatus(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, emptySet(), "getStatus")
        execute(call) { store.getStatus().toJsObject() }
    }

    @PluginMethod
    fun saveBaseUrl(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, setOf("baseUrl"), "saveBaseUrl")
        val baseUrl = call.requireText("baseUrl", StationStoreLimits.MAX_BASE_URL_LENGTH)
        execute(call) { JSObject().put("baseUrl", store.saveBaseUrl(baseUrl)) }
    }

    @PluginMethod
    fun loadBaseUrl(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, emptySet(), "loadBaseUrl")
        execute(call) { JSObject().put("baseUrl", store.loadBaseUrl() ?: JSONObject.NULL) }
    }

    @PluginMethod
    fun loadLatestEvaluationPair(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, setOf("raceId"), "loadLatestEvaluationPair")
        val raceId = call.requireText("raceId", 36)
        execute(call) {
            JSObject().put("pair", store.loadLatestEvaluationPair(raceId)?.toJsObject() ?: JSONObject.NULL)
        }
    }

    @PluginMethod
    fun beginDevicePairing(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, setOf("baseUrl", "grantToken"), "beginDevicePairing")
        val normalizedBaseUrl = BaseUrlNormalizer.normalize(
            call.requireText("baseUrl", StationStoreLimits.MAX_BASE_URL_LENGTH),
        )
        val grantToken = call.requireText("grantToken", StationPairingLimits.MAX_GRANT_LENGTH)
        execute(call) {
            val deviceId = store.getStatus().deviceId
            requireConfiguredBaseUrl(normalizedBaseUrl)
            pairingCoordinator.begin(normalizedBaseUrl, grantToken, deviceId).toJsObject()
        }
    }

    @PluginMethod
    fun getDevicePairingStatus(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, emptySet(), "getDevicePairingStatus")
        execute(call) { pairingCoordinator.status(store.getStatus().deviceId).toJsObject() }
    }

    @PluginMethod
    fun redeemDevicePairing(call: PluginCall) = withCall(call) {
        requireExactKeys(
            call.data,
            setOf("attemptId", "connectTimeoutMs", "readTimeoutMs"),
            "redeemDevicePairing",
        )
        val attemptId = call.requireText("attemptId", 36)
        val connectTimeoutMs = call.requireInt(
            "connectTimeoutMs",
            StationCredentialLimits.MIN_TIMEOUT_MS,
            StationCredentialLimits.MAX_CONNECT_TIMEOUT_MS,
        )
        val readTimeoutMs = call.requireInt(
            "readTimeoutMs",
            StationCredentialLimits.MIN_TIMEOUT_MS,
            StationCredentialLimits.MAX_READ_TIMEOUT_MS,
        )
        execute(call) {
            val deviceId = store.getStatus().deviceId
            val configuredBaseUrl = store.loadBaseUrl()
                ?: throw StationStoreFailure(StationStoreErrors.PAIRING_REQUEST, "Serveradress saknas")
            pairingCoordinator.redeem(
                attemptId,
                deviceId,
                configuredBaseUrl,
                connectTimeoutMs,
                readTimeoutMs,
            ).toJsObject()
        }
    }

    @PluginMethod
    fun discardDevicePairing(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, setOf("expectedAttemptId"), "discardDevicePairing")
        val expectedAttemptId = call.requireText("expectedAttemptId", 36)
        execute(call) {
            pairingCoordinator.discard(expectedAttemptId, store.getStatus().deviceId).toJsObject()
        }
    }

    @PluginMethod
    fun discardInvalidDevicePairing(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, setOf("confirmDeviceId"), "discardInvalidDevicePairing")
        val confirmDeviceId = call.requireText("confirmDeviceId", 36)
        execute(call) {
            pairingCoordinator.discardInvalid(
                confirmDeviceId,
                store.getStatus().deviceId,
            ).toJsObject()
        }
    }

    @PluginMethod
    fun getDeviceCredentialStatus(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, emptySet(), "getDeviceCredentialStatus")
        execute(call) {
            val deviceId = store.getStatus().deviceId
            credentialVault.status(deviceId).toJsObject()
        }
    }

    @PluginMethod
    fun authorizedStationRequest(call: PluginCall) = withCall(call) {
        val method = call.requireText("method", 4)
        val resource = call.requireText("resource", 32)
        val commonKeys = setOf(
            "baseUrl",
            "raceId",
            "resource",
            "method",
            "connectTimeoutMs",
            "readTimeoutMs",
        )
        val expectedKeys = if (method == "GET" && resource == "station-package") {
            commonKeys
        } else if (method == "POST" && resource == "device-batches") {
            commonKeys + setOf("bodyJson", "idempotencyKey")
        } else {
            throw StationStoreFailure(StationStoreErrors.AUTHORIZED_REQUEST, "Stationsrouten eller HTTP-metoden är inte tillåten")
        }
        requireExactKeys(call.data, expectedKeys, "authorizedStationRequest")
        val baseUrl = call.requireText("baseUrl", StationStoreLimits.MAX_BASE_URL_LENGTH)
        val normalizedBaseUrl = BaseUrlNormalizer.normalize(baseUrl)
        val raceId = call.requireText("raceId", 36)
        val request = AuthorizedStationRequest(
            baseUrl = normalizedBaseUrl,
            raceId = raceId,
            resource = resource,
            method = method,
            bodyJson = if (method == "POST") {
                call.requireText("bodyJson", StationCredentialLimits.MAX_REQUEST_BODY_BYTES)
            } else {
                null
            },
            idempotencyKey = if (method == "POST") call.requireText("idempotencyKey", 128) else null,
            connectTimeoutMs = call.requireInt(
                "connectTimeoutMs",
                StationCredentialLimits.MIN_TIMEOUT_MS,
                StationCredentialLimits.MAX_CONNECT_TIMEOUT_MS,
            ),
            readTimeoutMs = call.requireInt(
                "readTimeoutMs",
                StationCredentialLimits.MIN_TIMEOUT_MS,
                StationCredentialLimits.MAX_READ_TIMEOUT_MS,
            ),
        )
        execute(call) {
            val configuredBaseUrl = store.loadBaseUrl()
                ?: throw StationStoreFailure(StationStoreErrors.AUTHORIZED_REQUEST, "Serveradress saknas")
            if (configuredBaseUrl != normalizedBaseUrl) {
                throw StationStoreFailure(StationStoreErrors.AUTHORIZED_REQUEST, "Serveradressen matchar inte stationskonfigurationen")
            }
            val deviceId = store.getStatus().deviceId
            val credential = credentialVault.requireActive(deviceId, raceId)
            authorizedHttpClient.execute(request, credential).toJsObject()
        }
    }

    @PluginMethod
    fun enqueueEvent(call: PluginCall) = withCall(call) {
        requireExactKeys(
            call.data,
            setOf(
                "raceId",
                "sessionId",
                "packageVersion",
                "stationReceivedAt",
                "transport",
                "payloadJson",
                "contentHash",
            ),
            "enqueueEvent",
        )
        val request = EnqueueRequest(
            raceId = call.requireText("raceId", 36),
            sessionId = call.requireText("sessionId", 36),
            packageVersion = call.requireInt("packageVersion", 1, Int.MAX_VALUE),
            stationReceivedAt = call.requireText("stationReceivedAt", StationStoreLimits.MAX_TEXT_LENGTH),
            transport = call.requireText("transport", 32),
            payloadJson = call.requireText("payloadJson", StationStoreLimits.MAX_PAYLOAD_JSON_LENGTH),
            contentHash = call.requireText("contentHash", 64),
        )
        execute(call) { store.enqueueEvent(request).toJsObject() }
    }

    @PluginMethod
    fun listPending(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, setOf("limit"), "listPending")
        val limit = call.requireInt("limit", 1, StationStoreLimits.MAX_PENDING_LIMIT)
        execute(call) {
            val events = JSArray()
            store.listPending(limit).forEach { events.put(it.toJsObject()) }
            JSObject().put("events", events)
        }
    }

    @PluginMethod
    fun recordLocalEvaluation(call: PluginCall) = withCall(call) {
        requireExactKeys(
            call.data,
            setOf("localEvaluationJson", "evaluationHash"),
            "recordLocalEvaluation",
        )
        val localEvaluationJson = call.requireText(
            "localEvaluationJson",
            StationStoreLimits.MAX_LOCAL_EVALUATION_LENGTH,
        )
        val evaluationHash = call.requireText("evaluationHash", 64)
        execute(call) {
            store.recordLocalEvaluation(
                LocalEvaluationParser.parse(localEvaluationJson, evaluationHash),
            ).toJsObject()
        }
    }

    @PluginMethod
    fun applyAcknowledgements(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, setOf("acknowledgementJson"), "applyAcknowledgements")
        val acknowledgementJson = call.requireText(
            "acknowledgementJson",
            StationStoreLimits.MAX_ACKNOWLEDGEMENT_LENGTH,
        )
        execute(call) {
            store.applyAcknowledgements(AcknowledgementParser.parse(acknowledgementJson)).toJsObject()
        }
    }

    override fun handleOnDestroy() {
        if (::executor.isInitialized && ::store.isInitialized) {
            try {
                executor.execute { store.close() }
            } catch (_: RejectedExecutionException) {
                store.close()
            } finally {
                executor.shutdown()
            }
        }
    }

    private fun execute(call: PluginCall, operation: () -> JSObject) {
        try {
            executor.execute {
                try {
                    call.resolve(operation())
                } catch (failure: Throwable) {
                    reject(call, failure)
                }
            }
        } catch (failure: RejectedExecutionException) {
            reject(
                call,
                StationStoreFailure(
                    StationStoreErrors.INTERNAL,
                    "Stationslagret har stängts",
                    failure,
                ),
            )
        }
    }

    private fun InstalledPackageMetadata.toJsObject(): JSObject = JSObject()
        .put("status", status)
        .put("raceId", raceId)
        .put("packageVersion", packageVersion)
        .put("payloadSha256", payloadSha256)
        .put("keyId", keyId)

    private fun LoadedActivePackage.toJsObject(): JSObject = JSObject()
        .put("raceId", raceId)
        .put("packageVersion", packageVersion)
        .put("payloadSha256", payloadSha256)
        .put("keyId", keyId)
        .put("payloadJson", payloadJson)

    private fun StationStoreStatus.toJsObject(): JSObject {
        val packages = JSArray()
        activePackages.forEach { packageData ->
            packages.put(
                JSObject()
                    .put("raceId", packageData.raceId)
                    .put("packageVersion", packageData.packageVersion)
                    .put("payloadSha256", packageData.payloadSha256)
                    .put("keyId", packageData.keyId),
            )
        }
        return JSObject()
            .put("deviceId", deviceId)
            .put("nextLocalSequence", nextLocalSequence)
            .put("activePackages", packages)
            .put("readoutCount", readoutCount)
            .put("pendingCount", pendingCount)
            .put("acknowledgedCount", acknowledgedCount)
            .put("rejectedCount", rejectedCount)
            .put(
                "latestLocalEvaluation",
                latestLocalEvaluation?.let {
                    JSObject()
                        .put("localEvaluationJson", it.localEvaluationJson)
                        .put("evaluationHash", it.evaluationHash)
                } ?: JSONObject.NULL,
            )
    }

    private fun StoredOutboxEvent.toJsObject(): JSObject = JSObject()
        .put("deviceId", deviceId)
        .put("localSequence", localSequence)
        .put("sessionId", sessionId)
        .put("raceId", raceId)
        .put("packageVersion", packageVersion)
        .put("stationReceivedAt", stationReceivedAt)
        .put("transport", transport)
        .put("payloadJson", payloadJson)
        .put("contentHash", contentHash)

    private fun AppliedAcknowledgements.toJsObject(): JSObject = JSObject()
        .put("acknowledgedCount", acknowledgedCount)
        .put("rejectedCount", rejectedCount)
        .put("unchangedCount", unchangedCount)
        .put("pendingCount", pendingCount)

    private fun RecordedLocalEvaluation.toJsObject(): JSObject = JSObject()
        .put("status", status)
        .put("deviceId", deviceId)
        .put("localSequence", localSequence)
        .put("evaluationHash", evaluationHash)

    private fun LatestEvaluationPair.toJsObject(): JSObject = JSObject()
        .put("deviceId", deviceId)
        .put("localSequence", localSequence)
        .put("raceId", raceId)
        .put("packageVersion", packageVersion)
        .put("contentHash", contentHash)
        .put("outboxState", outboxState)
        .put("rejectionReason", rejectionReason ?: JSONObject.NULL)
        .put(
            "localEvaluation",
            localEvaluation?.let {
                JSObject()
                    .put("localEvaluationJson", it.localEvaluationJson)
                    .put("evaluationHash", it.evaluationHash)
            } ?: JSONObject.NULL,
        )
        .put("serverObservation", serverObservation?.toJsObject() ?: JSONObject.NULL)

    private fun ServerAckObservation.toJsObject(): JSObject = JSObject()
        .put("observationHash", observationHash)
        .put("rawMessageId", rawMessageId ?: JSONObject.NULL)
        .put("acknowledgementStatus", acknowledgementStatus)
        .put("rejectionReason", rejectionReason ?: JSONObject.NULL)
        .put("currentPackageVersion", currentPackageVersion)
        .put("packageVersionStatus", packageVersionStatus)
        .put("packageUpdateRequired", packageUpdateRequired)
        .put("serverResultJson", serverResultJson ?: JSONObject.NULL)
        .put("serverResultHash", serverResultHash ?: JSONObject.NULL)
        .put("evaluationHash", evaluationHash ?: JSONObject.NULL)
        .put("observedAtEpochMs", observedAtEpochMs)

    private fun StationCredentialMetadata.toJsObject(): JSObject = JSObject()
        .put("credentialId", credentialId)
        .put("deviceId", deviceId)
        .put("raceId", raceId)
        .put("scope", scope)
        .put("generation", generation)
        .put("issuedAt", issuedAt)
        .put("expiresAt", expiresAt)

    private fun StationCredentialStatus.toJsObject(): JSObject = when (this) {
        StationCredentialStatus.Missing -> JSObject().put("state", "missing")
        StationCredentialStatus.Invalid -> JSObject().put("state", "invalid")
        is StationCredentialStatus.Active -> JSObject()
            .put("state", "active")
            .put("credential", credential.toJsObject())
        is StationCredentialStatus.Expired -> JSObject()
            .put("state", "expired")
            .put("credential", credential.toJsObject())
    }

    private fun StationPairingStatus.toJsObject(): JSObject = when (this) {
        StationPairingStatus.None -> JSObject().put("state", "none")
        StationPairingStatus.Invalid -> JSObject().put("state", "invalid")
        is StationPairingStatus.Pending -> JSObject()
            .put("state", "pending")
            .put(
                "attempt",
                JSObject()
                    .put("attemptId", attempt.attemptId)
                    .put("deviceId", attempt.deviceId)
                    .put("startedAtEpochMs", attempt.startedAtEpochMs),
            )
        is StationPairingStatus.Completed -> JSObject()
            .put("state", "completed")
            .put("attemptId", attemptId)
            .put("credential", credential.toJsObject())
    }

    private fun StationPairingRedeemResult.toJsObject(): JSObject = JSObject()
        .put("status", status)
        .put("credential", credential.toJsObject())

    private fun AuthorizedStationResponse.toJsObject(): JSObject {
        val jsHeaders = JSObject()
        headers.forEach(jsHeaders::put)
        return JSObject()
            .put("status", status)
            .put("headers", jsHeaders)
            .put("data", data)
            .put("url", url)
    }

    private fun reject(call: PluginCall, failure: Throwable) {
        val mapped = failure as? StationStoreFailure
            ?: StationStoreFailure(
                StationStoreErrors.INTERNAL,
                "Stationslagret kunde inte slutföra operationen",
                failure,
            )
        call.reject(mapped.message, mapped.code)
    }

    private inline fun withCall(call: PluginCall, block: () -> Unit) {
        try {
            block()
        } catch (failure: Throwable) {
            reject(call, failure)
        }
    }

    private fun PluginCall.requireText(key: String, maxLength: Int): String {
        val value = data.opt(key) as? String
        if (value.isNullOrEmpty() || value.length > maxLength) {
            throw StationStoreFailure(StationStoreErrors.INVALID_ARGUMENT, "$key är ogiltigt")
        }
        return value
    }

    private fun PluginCall.requireInt(key: String, minimum: Int, maximum: Int): Int {
        val value = data.opt(key) as? Number
            ?: throw StationStoreFailure(StationStoreErrors.INVALID_ARGUMENT, "$key är ogiltigt")
        val longValue = value.toLong()
        if (value.toDouble() != longValue.toDouble() || longValue !in minimum.toLong()..maximum.toLong()) {
            throw StationStoreFailure(StationStoreErrors.INVALID_ARGUMENT, "$key är ogiltigt")
        }
        return longValue.toInt()
    }

    private fun requireConfiguredBaseUrl(normalizedBaseUrl: String) {
        val configured = store.loadBaseUrl()
            ?: throw StationStoreFailure(StationStoreErrors.PAIRING_REQUEST, "Serveradress saknas")
        if (configured != normalizedBaseUrl) {
            throw StationStoreFailure(
                StationStoreErrors.PAIRING_REQUEST,
                "Serveradressen matchar inte stationskonfigurationen",
            )
        }
    }

    private fun requireExactKeys(value: JSObject, required: Set<String>, path: String) {
        if (value.keys().asSequence().toSet() != required) {
            throw StationStoreFailure(StationStoreErrors.INVALID_ARGUMENT, "$path har ogiltiga fält")
        }
    }
}

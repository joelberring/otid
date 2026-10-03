package se.otid.station.usb

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.util.concurrent.CompletionException

@CapacitorPlugin(name = "OtidUsbSerial")
class OtidUsbSerialPlugin : Plugin() {
    private lateinit var backend: Mik3yUsbSerialBackend
    private lateinit var controller: RawUsbController
    private var receiverRegistered = false

    private val deviceReceiver = object : BroadcastReceiver() {
        override fun onReceive(receivedContext: Context?, intent: Intent?) {
            val device = intent?.usbDevice() ?: return
            when (intent.action) {
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                    backend.listDevices().firstOrNull { it.deviceId == device.deviceName }?.let(controller::onDeviceAttached)
                }
                UsbManager.ACTION_USB_DEVICE_DETACHED -> controller.onDeviceDetached(device.deviceName)
            }
        }
    }

    override fun load() {
        backend = Mik3yUsbSerialBackend(context)
        lateinit var dispatcher: SerialEventDispatcher
        dispatcher = SerialEventDispatcher(
            capacity = EVENT_QUEUE_CAPACITY,
            clock = NativeMonotonicClock(SystemClock::elapsedRealtimeNanos),
            consumer = ::emitEvent,
            onFailure = { code, message ->
                if (::controller.isInitialized) controller.onEventFailure(code, message)
            },
        )
        controller = RawUsbController(backend, dispatcher)
        val filter = IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        ContextCompat.registerReceiver(context, deviceReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        receiverRegistered = true
    }

    @PluginMethod
    fun listDevices(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, emptySet(), "listDevices")
        val devices = JSArray()
        controller.listDevices().forEach { devices.put(it.toJsObject()) }
        call.resolve(JSObject().put("devices", devices))
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, setOf("deviceId"), "requestPermission")
        val deviceId = call.requireText("deviceId")
        controller.requestPermission(deviceId).whenComplete { granted, failure ->
            if (failure != null) reject(call, failure)
            else call.resolve(JSObject().put("granted", granted == true))
        }
    }

    @PluginMethod
    fun open(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, setOf("connectionId", "deviceId", "portIndex", "configuration"), "open")
        val configuration = call.data.getJSObject("configuration")
            ?: throw RawUsbFailure("ANDROID_USB_INVALID_ARGUMENT", "configuration saknas")
        requireExactKeys(
            configuration,
            setOf("baudRate", "dataBits", "stopBits", "parity", "flowControl"),
            "configuration",
        )
        if (configuration.opt("flowControl") as? String != "none") {
            throw RawUsbFailure("ANDROID_USB_INVALID_CONFIGURATION", "flowControl måste vara none")
        }
        val request = RawUsbOpenRequest(
            connectionId = call.requireText("connectionId"),
            deviceId = call.requireText("deviceId"),
            portIndex = call.requireInt("portIndex", 0, 255),
            configuration = RawUsbConfiguration(
                baudRate = configuration.requireInt("baudRate", 1, Int.MAX_VALUE),
                dataBits = configuration.requireInt("dataBits", 7, 8),
                stopBits = configuration.requireInt("stopBits", 1, 2),
                parity = when (configuration.opt("parity") as? String) {
                    "none" -> RawUsbParity.NONE
                    "even" -> RawUsbParity.EVEN
                    "odd" -> RawUsbParity.ODD
                    else -> throw RawUsbFailure("ANDROID_USB_INVALID_CONFIGURATION", "parity är ogiltig")
                },
            ),
        )
        controller.open(request).whenComplete { _, failure ->
            if (failure != null) reject(call, failure) else call.resolve()
        }
    }

    @PluginMethod
    fun write(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, setOf("connectionId", "bytesBase64", "writeTimeoutMs"), "write")
        val bytes = decodeCanonicalBase64(call.requireText("bytesBase64"))
        val future = controller.write(
            call.requireText("connectionId"),
            bytes,
            call.requireInt("writeTimeoutMs", 1, RawUsbController.MAX_WRITE_TIMEOUT_MS),
        )
        future.whenComplete { _, failure ->
            if (failure != null) reject(call, failure) else call.resolve()
        }
    }

    @PluginMethod
    fun close(call: PluginCall) = withCall(call) {
        requireExactKeys(call.data, setOf("connectionId"), "close")
        controller.close(call.requireText("connectionId")).whenComplete { _, failure ->
            if (failure != null) reject(call, failure) else call.resolve()
        }
    }

    override fun handleOnDestroy() {
        if (receiverRegistered) {
            receiverRegistered = false
            context.unregisterReceiver(deviceReceiver)
        }
        if (::controller.isInitialized) {
            try {
                controller.close()
            } catch (_: Throwable) {
                Log.e(LOG_TAG, "ANDROID_USB_DESTROY_CLOSE_FAILED")
            }
        }
    }

    private fun emitEvent(event: RawUsbEvent) {
        val payload = event.payload
        val output = JSObject()
            .put("nativeSequence", event.nativeSequence.toString())
            .put("elapsedRealtimeNanos", event.elapsedRealtimeNanos.toString())
        when (payload) {
            is RawUsbEventPayload.Bytes -> output
                .put("type", "bytes")
                .put("connectionId", payload.connectionId)
                .put("bytesBase64", Base64.encodeToString(payload.bytes, Base64.NO_WRAP))
            is RawUsbEventPayload.Attach -> output
                .put("type", "attach")
                .put("connectionId", JSONObject.NULL)
                .put("device", payload.device.toJsObject())
            is RawUsbEventPayload.Detach -> output
                .put("type", "detach")
                .put("connectionId", payload.connectionId)
                .put("deviceId", payload.deviceId)
            is RawUsbEventPayload.State -> output
                .put("type", "state")
                .put("connectionId", payload.connectionId)
                .put("status", payload.status)
                .put("code", payload.code ?: JSONObject.NULL)
                .put("message", payload.message ?: JSONObject.NULL)
        }
        notifyListeners(EVENT_NAME, output)
    }

    private fun RawUsbDeviceDescriptor.toJsObject(): JSObject {
        val ports = JSArray()
        portIndexes.forEach(ports::put)
        return JSObject()
            .put("deviceId", deviceId)
            .put("vendorId", vendorId)
            .put("productId", productId)
            .put("portIndexes", ports)
            .also { output ->
                productName?.let { output.put("productName", it) }
                manufacturerName?.let { output.put("manufacturerName", it) }
            }
    }

    private fun reject(call: PluginCall, failure: Throwable) {
        val root = generateSequence(failure) { current ->
            (current as? CompletionException)?.cause
        }.last()
        val mapped = root as? RawUsbFailure
            ?: RawUsbFailure("ANDROID_USB_OPERATION_FAILED", "USB-operationen misslyckades")
        call.reject(mapped.message, mapped.code)
    }

    private inline fun withCall(call: PluginCall, block: () -> Unit) {
        try {
            block()
        } catch (failure: Throwable) {
            reject(call, failure)
        }
    }

    private fun PluginCall.requireText(key: String): String {
        val value = data.opt(key) as? String
        if (value.isNullOrBlank() || value.length > RawUsbController.MAX_TEXT_LENGTH) {
            throw RawUsbFailure("ANDROID_USB_INVALID_ARGUMENT", "$key är ogiltigt")
        }
        return value
    }

    private fun PluginCall.requireInt(key: String, min: Int, max: Int): Int = data.requireInt(key, min, max)

    private fun JSObject.requireInt(key: String, min: Int, max: Int): Int {
        val value = opt(key) as? Int
            ?: throw RawUsbFailure("ANDROID_USB_INVALID_ARGUMENT", "$key saknas")
        if (value !in min..max) throw RawUsbFailure("ANDROID_USB_INVALID_ARGUMENT", "$key är ogiltigt")
        return value
    }

    private fun requireExactKeys(value: JSObject, required: Set<String>, path: String) {
        val keys = value.keys().asSequence().toSet()
        if (keys != required) throw RawUsbFailure("ANDROID_USB_INVALID_ARGUMENT", "$path har ogiltiga fält")
    }

    private fun decodeCanonicalBase64(value: String): ByteArray {
        if (value.isEmpty() || value.length % 4 != 0 || !CANONICAL_BASE64.matches(value)) {
            throw RawUsbFailure("ANDROID_USB_INVALID_BASE64", "bytesBase64 är ogiltig")
        }
        val bytes = try {
            Base64.decode(value, Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            throw RawUsbFailure("ANDROID_USB_INVALID_BASE64", "bytesBase64 är ogiltig")
        }
        if (Base64.encodeToString(bytes, Base64.NO_WRAP) != value) {
            throw RawUsbFailure("ANDROID_USB_INVALID_BASE64", "bytesBase64 är inte kanonisk")
        }
        return bytes
    }

    @Suppress("DEPRECATION")
    private fun Intent.usbDevice(): UsbDevice? =
        if (android.os.Build.VERSION.SDK_INT >= 33) getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        else getParcelableExtra(UsbManager.EXTRA_DEVICE)

    companion object {
        const val EVENT_NAME = "usbEvent"
        const val EVENT_QUEUE_CAPACITY = 256
        const val LOG_TAG = "OtidUsbSerial"
        val CANONICAL_BASE64 = Regex("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")
    }
}

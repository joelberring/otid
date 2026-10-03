package se.otid.station.usb

import java.util.concurrent.CompletableFuture

data class RawUsbDeviceDescriptor(
    val deviceId: String,
    val vendorId: Int,
    val productId: Int,
    val portIndexes: List<Int>,
    val productName: String? = null,
    val manufacturerName: String? = null,
)

enum class RawUsbParity {
    NONE,
    EVEN,
    ODD,
}

data class RawUsbConfiguration(
    val baudRate: Int,
    val dataBits: Int,
    val stopBits: Int,
    val parity: RawUsbParity,
)

data class RawUsbOpenRequest(
    val connectionId: String,
    val deviceId: String,
    val portIndex: Int,
    val configuration: RawUsbConfiguration,
)

class RawUsbFailure(
    val code: String,
    override val message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

interface RawUsbSession {
    fun write(bytes: ByteArray, timeoutMs: Int)
    fun close()
}

interface RawUsbSessionListener {
    fun onBytes(bytes: ByteArray)
    fun onError(code: String, message: String)
}

interface RawUsbBackend : AutoCloseable {
    fun listDevices(): List<RawUsbDeviceDescriptor>
    fun requestPermission(deviceId: String): CompletableFuture<Boolean>
    fun open(request: RawUsbOpenRequest, listener: RawUsbSessionListener): RawUsbSession
    override fun close()
}

sealed interface RawUsbEventPayload {
    data class Bytes(val connectionId: String, val bytes: ByteArray) : RawUsbEventPayload
    data class Attach(val device: RawUsbDeviceDescriptor) : RawUsbEventPayload
    data class Detach(val connectionId: String, val deviceId: String) : RawUsbEventPayload

    data class State(
        val connectionId: String,
        val status: String,
        val code: String? = null,
        val message: String? = null,
    ) : RawUsbEventPayload
}

data class RawUsbEvent(
    val nativeSequence: Long,
    val elapsedRealtimeNanos: Long,
    val payload: RawUsbEventPayload,
)

fun interface NativeMonotonicClock {
    fun elapsedRealtimeNanos(): Long
}

interface RawUsbEventPublisher : AutoCloseable {
    fun publish(payload: RawUsbEventPayload): Boolean
    override fun close()
}

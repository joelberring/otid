package se.otid.station.usb

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicBoolean

class SerialEventDispatcher(
    capacity: Int,
    private val clock: NativeMonotonicClock,
    private val consumer: (RawUsbEvent) -> Unit,
    private val onFailure: (code: String, message: String) -> Unit,
) : RawUsbEventPublisher {
    private val sequence = AtomicLong(0)
    private val overflowed = AtomicBoolean(false)
    private val executor = ThreadPoolExecutor(
        1,
        1,
        0,
        TimeUnit.MILLISECONDS,
        ArrayBlockingQueue(capacity.coerceAtLeast(1)),
        ThreadFactory { runnable ->
            Thread(runnable, "otid-usb-events").apply { isDaemon = true }
        },
        ThreadPoolExecutor.AbortPolicy(),
    )

    override fun publish(payload: RawUsbEventPayload): Boolean {
        if (overflowed.get() && payload !is RawUsbEventPayload.State) return false
        val immutablePayload = payload.defensiveCopy()
        return try {
            executor.execute {
                val next = sequence.incrementAndGet()
                val nanos = clock.elapsedRealtimeNanos().coerceAtLeast(0)
                try {
                    consumer(RawUsbEvent(next, nanos, immutablePayload))
                } catch (_: Throwable) {
                    signalFailure(
                        "ANDROID_USB_EVENT_DELIVERY_FAILED",
                        "USB-event kunde inte levereras; anslutningen stängs",
                    )
                }
            }
            true
        } catch (_: RejectedExecutionException) {
            signalFailure("ANDROID_USB_EVENT_OVERFLOW", "USB-eventkön blev full; anslutningen stängs")
            false
        }
    }

    private fun signalFailure(code: String, message: String) {
        if (overflowed.compareAndSet(false, true)) {
            executor.queue.clear()
            onFailure(code, message)
        }
    }

    override fun close() {
        executor.shutdown()
        if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
            executor.shutdownNow()
        }
    }

    private fun RawUsbEventPayload.defensiveCopy(): RawUsbEventPayload = when (this) {
        is RawUsbEventPayload.Bytes -> copy(bytes = bytes.copyOf())
        is RawUsbEventPayload.Attach -> copy(device = device.copy(portIndexes = device.portIndexes.toList()))
        is RawUsbEventPayload.Detach -> copy()
        is RawUsbEventPayload.State -> copy()
    }
}

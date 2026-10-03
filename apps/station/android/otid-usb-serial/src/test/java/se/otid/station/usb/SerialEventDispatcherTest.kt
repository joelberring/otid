package se.otid.station.usb

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class SerialEventDispatcherTest {
    @Test
    fun `assigns global contiguous sequence and copies bytes`() {
        val received = Collections.synchronizedList(mutableListOf<RawUsbEvent>())
        val delivered = CountDownLatch(3)
        val nanos = AtomicInteger(9)
        val dispatcher = SerialEventDispatcher(
            capacity = 8,
            clock = NativeMonotonicClock { nanos.incrementAndGet().toLong() },
            consumer = {
                received += it
                delivered.countDown()
            },
            onFailure = { _, _ -> throw AssertionError("oväntat eventfel") },
        )
        val bytes = byteArrayOf(1, 2)

        dispatcher.publish(RawUsbEventPayload.Attach(RawUsbDeviceDescriptor("d", 1, 2, listOf(0))))
        dispatcher.publish(RawUsbEventPayload.Bytes("c", bytes))
        dispatcher.publish(RawUsbEventPayload.State("c", "open"))
        bytes[0] = 99

        assertEquals(true, delivered.await(2, TimeUnit.SECONDS))
        dispatcher.close()
        assertEquals(listOf(1L, 2L, 3L), received.map { it.nativeSequence })
        assertEquals(listOf(10L, 11L, 12L), received.map { it.elapsedRealtimeNanos })
        assertArrayEquals(byteArrayOf(1, 2), (received[1].payload as RawUsbEventPayload.Bytes).bytes)
    }

    @Test
    fun `overflow is explicit`() {
        val release = CountDownLatch(1)
        val entered = CountDownLatch(1)
        val overflow = AtomicInteger(0)
        val dispatcher = SerialEventDispatcher(
            capacity = 1,
            clock = NativeMonotonicClock { 1 },
            consumer = {
                entered.countDown()
                release.await(2, TimeUnit.SECONDS)
            },
            onFailure = { code, _ ->
                assertEquals("ANDROID_USB_EVENT_OVERFLOW", code)
                overflow.incrementAndGet()
            },
        )
        dispatcher.publish(RawUsbEventPayload.State("c", "opening"))
        entered.await(1, TimeUnit.SECONDS)
        dispatcher.publish(RawUsbEventPayload.State("c", "open"))

        assertEquals(false, dispatcher.publish(RawUsbEventPayload.State("c", "closing")))
        assertEquals(1, overflow.get())
        release.countDown()
        dispatcher.close()
    }
}

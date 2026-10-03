package se.otid.station.usb

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class RawUsbControllerTest {
    @Test
    fun `open preserves pre-commit bytes and emits ordered state`() {
        val publisher = RecordingPublisher()
        val backend = FakeBackend().apply {
            onOpen = { _, listener ->
                val source = byteArrayOf(1, 2, 3)
                listener.onBytes(source)
                source[0] = 99
                FakeSession()
            }
        }
        val controller = RawUsbController(backend, publisher)

        controller.open(request()).get(2, TimeUnit.SECONDS)

        val openedEvents = publisher.snapshot()
        assertEquals(listOf("opening", "bytes", "open"), openedEvents.map { it.label() })
        assertArrayEquals(byteArrayOf(1, 2, 3), (openedEvents[1] as RawUsbEventPayload.Bytes).bytes)
        controller.close("connection-1").get(2, TimeUnit.SECONDS)
        controller.close()
    }

    @Test
    fun `writes are FIFO defensive copies and requested close drains them`() {
        val publisher = RecordingPublisher()
        val session = FakeSession()
        val backend = FakeBackend().apply { onOpen = { _, _ -> session } }
        val controller = RawUsbController(backend, publisher)
        controller.open(request()).get(2, TimeUnit.SECONDS)
        val first = byteArrayOf(10, 11)
        val second = byteArrayOf(20)

        val firstWrite = controller.write("connection-1", first, 321)
        val secondWrite = controller.write("connection-1", second, 654)
        first[0] = 99
        second[0] = 99
        val close = controller.close("connection-1")

        firstWrite.get(2, TimeUnit.SECONDS)
        secondWrite.get(2, TimeUnit.SECONDS)
        close.get(2, TimeUnit.SECONDS)
        assertEquals(2, session.writes.size)
        assertArrayEquals(byteArrayOf(10, 11), session.writes[0].first)
        assertArrayEquals(byteArrayOf(20), session.writes[1].first)
        assertEquals(listOf(321, 654), session.writes.map { it.second })
        assertEquals(1, session.closeCount.get())
        assertEquals(listOf("opening", "open", "closing", "closed"), publisher.snapshot().map { it.label() })
        controller.close()
    }

    @Test
    fun `detach only closes selected device and rejects queued write`() {
        val publisher = RecordingPublisher()
        val gate = CountDownLatch(1)
        val entered = CountDownLatch(1)
        val session = FakeSession().apply {
            onWrite = { _, _ ->
                entered.countDown()
                gate.await(2, TimeUnit.SECONDS)
            }
        }
        val controller = RawUsbController(FakeBackend().apply { onOpen = { _, _ -> session } }, publisher)
        controller.open(request()).get(2, TimeUnit.SECONDS)
        val first = controller.write("connection-1", byteArrayOf(1), 1_000)
        assertTrue(entered.await(1, TimeUnit.SECONDS))
        val queued = controller.write("connection-1", byteArrayOf(2), 1_000)

        controller.onDeviceDetached("another-device")
        assertFalse(session.closed)
        controller.onDeviceDetached("device-1")
        gate.countDown()
        first.get(2, TimeUnit.SECONDS)
        val failure = assertThrows(Exception::class.java) { queued.get(2, TimeUnit.SECONDS) }

        assertTrue(failure.cause is RawUsbFailure)
        waitUntil { publisher.snapshot().any { it is RawUsbEventPayload.State && it.status == "closed" } }
        assertEquals(1, publisher.snapshot().count { it is RawUsbEventPayload.Detach })
        assertEquals(1, session.closeCount.get())
        controller.close()
    }

    @Test
    fun `write failure is sanitized and closes once`() {
        val publisher = RecordingPublisher()
        val session = FakeSession().apply {
            onWrite = { _, _ -> throw IllegalStateException("secret raw bytes 01 02") }
        }
        val controller = RawUsbController(FakeBackend().apply { onOpen = { _, _ -> session } }, publisher)
        controller.open(request()).get(2, TimeUnit.SECONDS)

        val failure = assertThrows(Exception::class.java) {
            controller.write("connection-1", byteArrayOf(1, 2), 100).get(2, TimeUnit.SECONDS)
        }

        assertEquals("USB-serieportens skrivning misslyckades", failure.cause?.message)
        assertFalse(failure.cause?.message.orEmpty().contains("01 02"))
        waitUntil { publisher.snapshot().any { it is RawUsbEventPayload.State && it.status == "closed" } }
        assertEquals(1, session.closeCount.get())
        controller.close()
    }

    @Test
    fun `failed open emits explicit error and releases connection for retry`() {
        val publisher = RecordingPublisher()
        val backend = FakeBackend().apply {
            onOpen = { _, _ -> throw RawUsbFailure("ANDROID_USB_TEST_OPEN", "Öppning misslyckades") }
        }
        val controller = RawUsbController(backend, publisher)

        val failure = assertThrows(Exception::class.java) { controller.open(request()).get(2, TimeUnit.SECONDS) }
        assertEquals("ANDROID_USB_TEST_OPEN", (failure.cause as RawUsbFailure).code)
        waitUntil { publisher.snapshot().any { it is RawUsbEventPayload.State && it.status == "closed" } }

        backend.onOpen = { _, _ -> FakeSession() }
        controller.open(request(connectionId = "connection-2")).get(2, TimeUnit.SECONDS)
        controller.close("connection-2").get(2, TimeUnit.SECONDS)
        controller.close()
    }

    @Test
    fun `permission and device listing stay protocol neutral`() {
        val descriptor = RawUsbDeviceDescriptor("usb-path", 1, 2, listOf(0, 1), "Adapter", "Vendor")
        val backend = FakeBackend().apply {
            devices = listOf(descriptor)
            permission = true
        }
        val controller = RawUsbController(backend, RecordingPublisher())

        val listed = controller.listDevices()
        assertEquals(listOf(descriptor), listed)
        assertTrue(controller.requestPermission("usb-path").get(1, TimeUnit.SECONDS))
        controller.close()
    }

    @Test
    fun `concurrent close is idempotent and close failure can be retried`() {
        val publisher = RecordingPublisher()
        val session = FakeSession()
        val controller = RawUsbController(FakeBackend().apply { onOpen = { _, _ -> session } }, publisher)
        controller.open(request()).get(2, TimeUnit.SECONDS)

        val firstClose = controller.close("connection-1")
        val sameClose = controller.close("connection-1")
        assertTrue(firstClose === sameClose)
        firstClose.get(2, TimeUnit.SECONDS)
        assertEquals(1, session.closeCount.get())
        controller.close()
    }

    @Test
    fun `close error is explicit and a second close retries cleanup`() {
        val publisher = RecordingPublisher()
        val session = FakeSession()
        val closeAttempts = AtomicInteger(0)
        session.onClose = {
            if (closeAttempts.incrementAndGet() == 1) throw IllegalStateException("native detail")
        }
        val controller = RawUsbController(FakeBackend().apply { onOpen = { _, _ -> session } }, publisher)
        controller.open(request()).get(2, TimeUnit.SECONDS)

        val first = assertThrows(Exception::class.java) {
            controller.close("connection-1").get(2, TimeUnit.SECONDS)
        }
        assertEquals("USB-serieporten kunde inte stängas", first.cause?.message)
        controller.close("connection-1").get(2, TimeUnit.SECONDS)

        assertEquals(2, session.closeCount.get())
        assertEquals(1, publisher.snapshot().count { it is RawUsbEventPayload.State && it.status == "closed" })
        controller.close()
    }

    @Test
    fun `event overflow is an explicit terminal error`() {
        val publisher = RecordingPublisher()
        val session = FakeSession()
        val controller = RawUsbController(FakeBackend().apply { onOpen = { _, _ -> session } }, publisher)
        controller.open(request()).get(2, TimeUnit.SECONDS)

        controller.onEventOverflow()

        waitUntil { publisher.snapshot().any { it is RawUsbEventPayload.State && it.status == "closed" } }
        val error = publisher.snapshot().filterIsInstance<RawUsbEventPayload.State>().first { it.status == "error" }
        assertEquals("ANDROID_USB_EVENT_OVERFLOW", error.code)
        assertEquals(1, session.closeCount.get())
        controller.close()
    }

    private fun request(connectionId: String = "connection-1") = RawUsbOpenRequest(
        connectionId = connectionId,
        deviceId = "device-1",
        portIndex = 0,
        configuration = RawUsbConfiguration(38_400, 8, 1, RawUsbParity.NONE),
    )

    private fun waitUntil(condition: () -> Boolean) {
        repeat(100) {
            if (condition()) return
            Thread.sleep(10)
        }
        throw AssertionError("Villkoret uppfylldes inte")
    }

    private class RecordingPublisher : RawUsbEventPublisher {
        private val payloads = Collections.synchronizedList(mutableListOf<RawUsbEventPayload>())
        override fun publish(payload: RawUsbEventPayload): Boolean {
            payloads += payload
            return true
        }
        fun snapshot(): List<RawUsbEventPayload> = synchronized(payloads) { payloads.toList() }
        override fun close() = Unit
    }

    private class FakeBackend : RawUsbBackend {
        var devices: List<RawUsbDeviceDescriptor> = emptyList()
        var permission = true
        var onOpen: (RawUsbOpenRequest, RawUsbSessionListener) -> RawUsbSession = { _, _ -> FakeSession() }
        override fun listDevices() = devices
        override fun requestPermission(deviceId: String) = CompletableFuture.completedFuture(permission)
        override fun open(request: RawUsbOpenRequest, listener: RawUsbSessionListener) = onOpen(request, listener)
        override fun close() = Unit
    }

    private class FakeSession : RawUsbSession {
        val writes = Collections.synchronizedList(mutableListOf<Pair<ByteArray, Int>>())
        val closeCount = AtomicInteger(0)
        var closed = false
        var onWrite: (ByteArray, Int) -> Unit = { _, _ -> }
        var onClose: () -> Unit = {}
        override fun write(bytes: ByteArray, timeoutMs: Int) {
            onWrite(bytes, timeoutMs)
            writes += bytes.copyOf() to timeoutMs
        }
        override fun close() {
            closeCount.incrementAndGet()
            onClose()
            closed = true
        }
    }

    private fun RawUsbEventPayload.label(): String = when (this) {
        is RawUsbEventPayload.Bytes -> "bytes"
        is RawUsbEventPayload.Attach -> "attach"
        is RawUsbEventPayload.Detach -> "detach"
        is RawUsbEventPayload.State -> status
    }
}

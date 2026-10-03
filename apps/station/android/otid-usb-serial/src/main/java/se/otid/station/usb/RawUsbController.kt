package se.otid.station.usb

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

class RawUsbController(
    private val backend: RawUsbBackend,
    private val events: RawUsbEventPublisher,
    private val lifecycleExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "otid-usb-lifecycle").apply { isDaemon = true }
    },
    private val writeExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "otid-usb-writer").apply { isDaemon = true }
    },
) : AutoCloseable {
    private enum class Phase { OPENING, OPEN, CLOSING, ERROR }

    private data class Active(
        val connectionId: String,
        val deviceId: String,
        val generation: Long,
        var phase: Phase,
        var session: RawUsbSession? = null,
        var abortWrites: Boolean = false,
        var termination: CompletableFuture<Void>? = null,
    )

    private val lock = Any()
    private val generation = AtomicLong(0)
    private var active: Active? = null
    private var lastClosedConnectionId: String? = null
    private var shuttingDown = false

    fun listDevices(): List<RawUsbDeviceDescriptor> = backend.listDevices().map {
        it.copy(portIndexes = it.portIndexes.toList())
    }

    fun requestPermission(deviceId: String): CompletableFuture<Boolean> =
        backend.requestPermission(requireText(deviceId, "deviceId"))

    fun open(request: RawUsbOpenRequest): CompletableFuture<Void> {
        validateOpenRequest(request)
        val opened = CompletableFuture<Void>()
        val current = synchronized(lock) {
            checkAvailable()
            Active(
                connectionId = request.connectionId,
                deviceId = request.deviceId,
                generation = generation.incrementAndGet(),
                phase = Phase.OPENING,
            ).also { active = it }
        }
        publishOrOverflow(RawUsbEventPayload.State(current.connectionId, "opening"))

        lifecycleExecutor.execute {
            try {
                val session = backend.open(request, listenerFor(current))
                val committed = synchronized(lock) {
                    if (active === current && current.phase == Phase.OPENING && !current.abortWrites) {
                        current.session = session
                        current.phase = Phase.OPEN
                        true
                    } else {
                        false
                    }
                }
                if (!committed) {
                    closeSession(session)?.let { cleanupFailure ->
                        publishOrOverflow(
                            RawUsbEventPayload.State(
                                current.connectionId,
                                "error",
                                cleanupFailure.code,
                                cleanupFailure.message,
                            ),
                        )
                    }
                    opened.completeExceptionally(
                        RawUsbFailure("ANDROID_USB_OPEN_CANCELLED", "USB-öppningen avbröts"),
                    )
                } else {
                    publishOrOverflow(RawUsbEventPayload.State(current.connectionId, "open"))
                    opened.complete(null)
                }
            } catch (failure: Throwable) {
                val mapped = failure.asRawUsbFailure(
                    "ANDROID_USB_OPEN_FAILED",
                    "USB-serieporten kunde inte öppnas",
                )
                synchronized(lock) {
                    if (active === current) {
                        current.phase = Phase.ERROR
                        current.abortWrites = true
                    }
                }
                publishOrOverflow(
                    RawUsbEventPayload.State(current.connectionId, "error", mapped.code, mapped.message),
                )
                opened.completeExceptionally(mapped)
                terminate(current, drainWrites = false)
            }
        }
        return opened
    }

    fun write(connectionId: String, bytes: ByteArray, timeoutMs: Int): CompletableFuture<Void> {
        requireText(connectionId, "connectionId")
        if (bytes.isEmpty()) throw RawUsbFailure("EMPTY_WRITE", "Tomma skrivningar tillåts inte")
        if (bytes.size > MAX_WRITE_BYTES) {
            throw RawUsbFailure("ANDROID_USB_WRITE_TOO_LARGE", "Skrivningen överskrider tillåten storlek")
        }
        if (timeoutMs !in 1..MAX_WRITE_TIMEOUT_MS) {
            throw RawUsbFailure("ANDROID_USB_INVALID_WRITE_TIMEOUT", "writeTimeoutMs är ogiltig")
        }
        val current = synchronized(lock) {
            active?.takeIf { it.connectionId == connectionId && it.phase == Phase.OPEN }
                ?: throw RawUsbFailure("ANDROID_USB_NOT_OPEN", "USB-anslutningen är inte öppen")
        }
        val copy = bytes.copyOf()
        val written = CompletableFuture<Void>()
        writeExecutor.execute {
            val session = synchronized(lock) {
                if (active !== current || current.abortWrites) null else current.session
            }
            if (session == null) {
                written.completeExceptionally(
                    RawUsbFailure("ANDROID_USB_WRITE_CANCELLED", "Skrivningen avbröts"),
                )
                return@execute
            }
            try {
                session.write(copy, timeoutMs)
                written.complete(null)
            } catch (failure: Throwable) {
                val mapped = failure.asRawUsbFailure(
                    "ANDROID_USB_WRITE_FAILED",
                    "USB-serieportens skrivning misslyckades",
                )
                written.completeExceptionally(mapped)
                fail(current, mapped)
            }
        }
        return written
    }

    fun close(connectionId: String): CompletableFuture<Void> {
        requireText(connectionId, "connectionId")
        val current = synchronized(lock) {
            val found = active
            if (found == null && lastClosedConnectionId == connectionId) return CompletableFuture.completedFuture(null)
            if (found == null || found.connectionId != connectionId) {
                throw RawUsbFailure("ANDROID_USB_CONNECTION_MISMATCH", "Anslutnings-ID matchar inte aktiv anslutning")
            }
            if (found.phase != Phase.CLOSING) {
                found.phase = Phase.CLOSING
                publishOrOverflow(RawUsbEventPayload.State(found.connectionId, "closing"))
            }
            found
        }
        return terminate(current, drainWrites = true)
    }

    fun onDeviceAttached(device: RawUsbDeviceDescriptor) {
        publishOrOverflow(RawUsbEventPayload.Attach(device.copy(portIndexes = device.portIndexes.toList())))
    }

    fun onDeviceDetached(deviceId: String) {
        val current = synchronized(lock) {
            active?.takeIf { it.deviceId == deviceId }?.also {
                it.abortWrites = true
                it.phase = Phase.CLOSING
            }
        } ?: return
        publishOrOverflow(RawUsbEventPayload.Detach(current.connectionId, current.deviceId))
        terminate(current, drainWrites = false)
    }

    fun onEventOverflow() {
        onEventFailure("ANDROID_USB_EVENT_OVERFLOW", "USB-eventkön blev full; anslutningen stängs")
    }

    fun onEventFailure(code: String, message: String) {
        requireText(code, "code")
        requireText(message, "message")
        val current = synchronized(lock) {
            active?.also {
                it.abortWrites = true
                it.phase = Phase.ERROR
            }
        } ?: return
        events.publish(
            RawUsbEventPayload.State(
                current.connectionId,
                "error",
                code,
                message,
            ),
        )
        terminate(current, drainWrites = false)
    }

    override fun close() {
        val current = synchronized(lock) {
            shuttingDown = true
            active?.also {
                it.abortWrites = true
                it.phase = Phase.CLOSING
            }
        }
        var failure: Throwable? = null
        try {
            if (current != null) terminate(current, drainWrites = false).get(5, TimeUnit.SECONDS)
        } catch (caught: Throwable) {
            failure = caught
        }
        try {
            backend.close()
        } catch (caught: Throwable) {
            if (failure == null) failure = caught
        } finally {
            lifecycleExecutor.shutdown()
            writeExecutor.shutdownNow()
            events.close()
        }
        failure?.let { throw it.asRawUsbFailure("ANDROID_USB_CLOSE_FAILED", "USB-controllern kunde inte stängas") }
    }

    private fun listenerFor(expected: Active): RawUsbSessionListener = object : RawUsbSessionListener {
        override fun onBytes(bytes: ByteArray) {
            val accepted = synchronized(lock) {
                active === expected && expected.phase != Phase.ERROR && expected.phase != Phase.CLOSING
            }
            if (accepted) publishOrOverflow(RawUsbEventPayload.Bytes(expected.connectionId, bytes.copyOf()))
        }

        override fun onError(code: String, message: String) {
            fail(expected, RawUsbFailure(requireText(code, "code"), requireText(message, "message")))
        }
    }

    private fun fail(current: Active, failure: RawUsbFailure) {
        val accepted = synchronized(lock) {
            if (active !== current || current.phase == Phase.ERROR || current.phase == Phase.CLOSING) false
            else {
                current.phase = Phase.ERROR
                current.abortWrites = true
                true
            }
        }
        if (!accepted) return
        publishOrOverflow(
            RawUsbEventPayload.State(current.connectionId, "error", failure.code, failure.message),
        )
        terminate(current, drainWrites = false)
    }

    private fun terminate(current: Active, drainWrites: Boolean): CompletableFuture<Void> {
        var schedule = false
        val closed = synchronized(lock) {
            current.termination ?: CompletableFuture<Void>().also {
                current.termination = it
                schedule = true
            }
        }
        if (!schedule) return closed
        lifecycleExecutor.execute {
            try {
                if (drainWrites) {
                    val barrier = CompletableFuture<Void>()
                    writeExecutor.execute { barrier.complete(null) }
                    barrier.get(MAX_WRITE_TIMEOUT_MS.toLong() + 1_000, TimeUnit.MILLISECONDS)
                } else {
                    synchronized(lock) { current.abortWrites = true }
                }
                val closeFailure = closeSession(current.session)
                if (closeFailure != null) {
                    synchronized(lock) {
                        if (active === current) {
                            current.phase = Phase.ERROR
                            current.abortWrites = true
                            current.termination = null
                        }
                    }
                    publishOrOverflow(
                        RawUsbEventPayload.State(
                            current.connectionId,
                            "error",
                            closeFailure.code,
                            closeFailure.message,
                        ),
                    )
                    closed.completeExceptionally(closeFailure)
                    return@execute
                }
                val didClose = synchronized(lock) {
                    if (active === current) {
                        active = null
                        lastClosedConnectionId = current.connectionId
                        true
                    } else {
                        false
                    }
                }
                if (didClose) publishOrOverflow(RawUsbEventPayload.State(current.connectionId, "closed"))
                closed.complete(null)
            } catch (failure: Throwable) {
                val mapped = failure.asRawUsbFailure("ANDROID_USB_CLOSE_FAILED", "USB-serieporten kunde inte stängas")
                synchronized(lock) {
                    if (active === current) {
                        current.phase = Phase.ERROR
                        current.termination = null
                    }
                }
                publishOrOverflow(RawUsbEventPayload.State(current.connectionId, "error", mapped.code, mapped.message))
                closed.completeExceptionally(mapped)
            }
        }
        return closed
    }

    private fun publishOrOverflow(payload: RawUsbEventPayload) {
        if (!events.publish(payload) && payload !is RawUsbEventPayload.State) onEventOverflow()
    }

    private fun validateOpenRequest(request: RawUsbOpenRequest) {
        requireText(request.connectionId, "connectionId")
        requireText(request.deviceId, "deviceId")
        if (request.portIndex !in 0..255) throw RawUsbFailure("ANDROID_USB_INVALID_PORT", "portIndex är ogiltigt")
        if (request.configuration.baudRate <= 0 || request.configuration.dataBits !in setOf(7, 8) ||
            request.configuration.stopBits !in setOf(1, 2)
        ) {
            throw RawUsbFailure("ANDROID_USB_INVALID_CONFIGURATION", "Seriekonfigurationen är ogiltig")
        }
    }

    private fun checkAvailable() {
        if (shuttingDown) throw RawUsbFailure("ANDROID_USB_SHUTTING_DOWN", "USB-controllern stängs")
        if (active != null) throw RawUsbFailure("ANDROID_USB_ALREADY_OPEN", "En USB-anslutning är redan aktiv")
    }

    private fun closeSession(session: RawUsbSession?): RawUsbFailure? = try {
        session?.close()
        null
    } catch (failure: Throwable) {
        failure.asRawUsbFailure("ANDROID_USB_CLOSE_FAILED", "USB-serieporten kunde inte stängas")
    }

    private fun requireText(value: String, field: String): String {
        if (value.isBlank() || value.length > MAX_TEXT_LENGTH) {
            throw RawUsbFailure("ANDROID_USB_INVALID_ARGUMENT", "$field är ogiltigt")
        }
        return value
    }

    private fun Throwable.asRawUsbFailure(defaultCode: String, defaultMessage: String): RawUsbFailure =
        if (this is RawUsbFailure) this else RawUsbFailure(defaultCode, defaultMessage, this)

    companion object {
        const val MAX_WRITE_BYTES = 1_048_576
        const val MAX_WRITE_TIMEOUT_MS = 60_000
        const val MAX_TEXT_LENGTH = 1_024
    }
}

package se.otid.station.usb

import android.content.Context
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import com.hoho.android.usbserial.driver.UsbSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicBoolean

class Mik3yUsbSerialBackend(context: Context) : RawUsbBackend {
    private val applicationContext = context.applicationContext
    private val usbManager = applicationContext.getSystemService(Context.USB_SERVICE) as UsbManager
    private val permissions = UsbPermissionBroker(applicationContext, usbManager)

    override fun listDevices(): List<RawUsbDeviceDescriptor> = drivers().map { (device, driver) ->
        RawUsbDeviceDescriptor(
            deviceId = device.deviceName,
            vendorId = device.vendorId,
            productId = device.productId,
            portIndexes = driver.ports.indices.toList(),
            productName = device.productName?.takeIf(String::isNotBlank),
            manufacturerName = device.manufacturerName?.takeIf(String::isNotBlank),
        )
    }.sortedBy { it.deviceId }

    override fun requestPermission(deviceId: String): CompletableFuture<Boolean> {
        val device = usbManager.deviceList.values.firstOrNull { it.deviceName == deviceId }
            ?: throw RawUsbFailure("ANDROID_USB_DEVICE_NOT_FOUND", "USB-enheten hittades inte")
        return permissions.request(device)
    }

    override fun open(request: RawUsbOpenRequest, listener: RawUsbSessionListener): RawUsbSession {
        val pair = drivers().firstOrNull { it.first.deviceName == request.deviceId }
            ?: throw RawUsbFailure("ANDROID_USB_DEVICE_NOT_FOUND", "USB-enheten hittades inte")
        val device = pair.first
        val driver = pair.second
        if (!usbManager.hasPermission(device)) {
            throw RawUsbFailure("ANDROID_USB_PERMISSION_DENIED", "USB-behörighet saknas")
        }
        val port = driver.ports.getOrNull(request.portIndex)
            ?: throw RawUsbFailure("ANDROID_USB_PORT_NOT_FOUND", "USB-serieporten hittades inte")
        val connection = usbManager.openDevice(device)
            ?: throw RawUsbFailure("ANDROID_USB_OPEN_FAILED", "USB-enheten kunde inte öppnas")
        try {
            port.open(connection)
            port.setParameters(
                request.configuration.baudRate,
                request.configuration.dataBits,
                request.configuration.stopBits,
                request.configuration.parity.toDriverParity(),
            )
            port.setFlowControl(UsbSerialPort.FlowControl.NONE)
            return Mik3yRawUsbSession(port, listener)
        } catch (failure: Throwable) {
            try {
                if (port.isOpen) port.close() else connection.close()
            } catch (cleanupFailure: Throwable) {
                failure.addSuppressed(cleanupFailure)
                try {
                    connection.close()
                } catch (connectionFailure: Throwable) {
                    failure.addSuppressed(connectionFailure)
                }
            }
            throw RawUsbFailure("ANDROID_USB_OPEN_FAILED", "USB-serieporten kunde inte konfigureras", failure)
        }
    }

    override fun close() {
        permissions.close()
    }

    private fun drivers(): List<Pair<UsbDevice, UsbSerialDriver>> =
        UsbSerialProber.getDefaultProber().findAllDrivers(usbManager).map { it.device to it }

    private fun RawUsbParity.toDriverParity(): Int = when (this) {
        RawUsbParity.NONE -> UsbSerialPort.PARITY_NONE
        RawUsbParity.EVEN -> UsbSerialPort.PARITY_EVEN
        RawUsbParity.ODD -> UsbSerialPort.PARITY_ODD
    }

    private class Mik3yRawUsbSession(
        private val port: UsbSerialPort,
        private val listener: RawUsbSessionListener,
    ) : RawUsbSession {
        private val running = AtomicBoolean(true)
        @Volatile private var closed = false
        private val reader = Thread(::readLoop, "otid-usb-reader").apply {
            isDaemon = true
            start()
        }

        override fun write(bytes: ByteArray, timeoutMs: Int) {
            if (!running.get()) throw RawUsbFailure("ANDROID_USB_NOT_OPEN", "USB-serieporten är stängd")
            try {
                port.write(bytes.copyOf(), timeoutMs)
            } catch (failure: Throwable) {
                throw RawUsbFailure("ANDROID_USB_WRITE_FAILED", "USB-serieportens skrivning misslyckades", failure)
            }
        }

        @Synchronized
        override fun close() {
            if (closed) return
            running.set(false)
            try {
                port.close()
                closed = true
            } catch (failure: Throwable) {
                throw RawUsbFailure("ANDROID_USB_CLOSE_FAILED", "USB-serieporten kunde inte stängas", failure)
            }
            if (Thread.currentThread() !== reader) reader.join(1_000)
        }

        private fun readLoop() {
            val buffer = ByteArray(READ_BUFFER_BYTES)
            while (running.get()) {
                try {
                    val count = port.read(buffer, READ_TIMEOUT_MS)
                    if (count > 0) listener.onBytes(buffer.copyOf(count))
                } catch (_: Throwable) {
                    if (running.get()) listener.onError("ANDROID_USB_READ_FAILED", "USB-serieportens läsning misslyckades")
                    return
                }
            }
        }

        companion object {
            const val READ_BUFFER_BYTES = 4_096
            const val READ_TIMEOUT_MS = 250
        }
    }
}

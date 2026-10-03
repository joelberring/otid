package se.otid.station.usb

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import androidx.core.content.ContextCompat
import java.util.concurrent.CompletableFuture

class UsbPermissionBroker(
    private val context: Context,
    private val usbManager: UsbManager,
) : AutoCloseable {
    private data class Pending(val deviceId: String, val result: CompletableFuture<Boolean>)

    private val action = "${context.packageName}.OTID_USB_PERMISSION"
    private val lock = Any()
    private var pending: Pending? = null
    private var registered = true

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(receivedContext: Context?, intent: Intent?) {
            if (intent?.action != action) return
            val device = intent.usbDevice() ?: return
            val completion = synchronized(lock) {
                pending?.takeIf { it.deviceId == device.deviceName }?.also { pending = null }
            } ?: return
            completion.result.complete(intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false))
        }
    }

    init {
        ContextCompat.registerReceiver(
            context,
            receiver,
            IntentFilter(action),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
    }

    fun request(device: UsbDevice): CompletableFuture<Boolean> {
        if (usbManager.hasPermission(device)) return CompletableFuture.completedFuture(true)
        val result = CompletableFuture<Boolean>()
        synchronized(lock) {
            if (!registered) throw RawUsbFailure("ANDROID_USB_PERMISSION_CLOSED", "USB-behörighetsgränsen är stängd")
            if (pending != null) {
                throw RawUsbFailure("ANDROID_USB_PERMISSION_PENDING", "En USB-behörighetsdialog är redan aktiv")
            }
            pending = Pending(device.deviceName, result)
        }
        val intent = Intent(action).setPackage(context.packageName)
        val permissionIntent = PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        try {
            usbManager.requestPermission(device, permissionIntent)
        } catch (failure: Throwable) {
            synchronized(lock) {
                if (pending?.result === result) pending = null
            }
            result.completeExceptionally(
                RawUsbFailure("ANDROID_USB_PERMISSION_FAILED", "USB-behörighet kunde inte begäras", failure),
            )
        }
        return result
    }

    override fun close() {
        val completion = synchronized(lock) {
            if (!registered) return
            registered = false
            pending?.also { pending = null }
        }
        context.unregisterReceiver(receiver)
        completion?.result?.complete(false)
    }

    @Suppress("DEPRECATION")
    private fun Intent.usbDevice(): UsbDevice? =
        if (android.os.Build.VERSION.SDK_INT >= 33) getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        else getParcelableExtra(UsbManager.EXTRA_DEVICE)
}

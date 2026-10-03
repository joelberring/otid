package se.otid.participant

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.IBinder
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
import se.otid.participant.gps.GpsJournal
import se.otid.participant.gps.GpsRecordingState
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Narrow bridge for the local, developer-only recorder. No account or upload API is exposed. */
@CapacitorPlugin(
    name = "OtidGpsRecorder",
    permissions = [
        Permission(alias = "location", strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION]),
        Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS]),
    ],
)
class GpsRecorderPlugin : Plugin() {
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()

    @PluginMethod
    fun getStatus(call: PluginCall) {
        worker.execute {
            val active = GpsRecordingService.activeStatus()
            if (active != null) {
                call.resolve(active.toJs())
                return@execute
            }
            var journal: GpsJournal? = null
            try {
                journal = GpsJournal(context.applicationContext)
                var latest = journal.latest()
                var reason: String? = null
                if (latest?.state == GpsRecordingState.RECORDING) {
                    latest = journal.interruptOpen(System.currentTimeMillis()) ?: latest
                    reason = "service_interrupted"
                }
                val state = when (latest?.state) {
                    GpsRecordingState.INTERRUPTED -> GpsRecorderState.INTERRUPTED
                    GpsRecordingState.STOPPED -> GpsRecorderState.STOPPED
                    GpsRecordingState.RECORDING -> GpsRecorderState.INTERRUPTED
                    null -> GpsRecorderState.IDLE
                }
                call.resolve(latest.toStatus(state, reason).toJs())
            } catch (_: Throwable) {
                call.resolve(GpsRecorderStatus(GpsRecorderState.STORAGE_ERROR, reason = "journal_error").toJs())
            } finally {
                journal?.close()
            }
        }
    }

    @PluginMethod
    fun start(call: PluginCall) = requestStartPermissions(call, GpsRecordingService.ACTION_START, null)

    @PluginMethod
    fun resume(call: PluginCall) {
        worker.execute {
            val journal = try {
                GpsJournal(context.applicationContext)
            } catch (_: Throwable) {
                call.resolve(GpsRecorderStatus(GpsRecorderState.STORAGE_ERROR, reason = "journal_error").toJs())
                return@execute
            }
            var journalFailed = false
            val recordingId = try {
                journal.latest()?.takeIf { it.state == GpsRecordingState.INTERRUPTED }?.id
            } catch (_: Throwable) {
                journalFailed = true
                null
            } finally {
                journal.close()
            }
            if (recordingId == null) {
                val status = if (journalFailed) {
                    GpsRecorderStatus(GpsRecorderState.STORAGE_ERROR, reason = "journal_error")
                } else {
                    GpsRecordingService.activeStatus()
                        ?: GpsRecorderStatus(GpsRecorderState.IDLE, reason = "no_interrupted_recording")
                }
                call.resolve(status.toJs())
            } else {
                getActivity().runOnUiThread {
                    requestStartPermissions(call, GpsRecordingService.ACTION_RESUME, recordingId)
                }
            }
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        worker.execute {
            try {
                val live = GpsRecordingService.stopActive()
                if (live != null) {
                    call.resolve(live.toJs())
                    return@execute
                }
                val journal = GpsJournal(context.applicationContext)
                try {
                    var latest = journal.latest()
                    if (latest?.state == GpsRecordingState.RECORDING) {
                        latest = journal.interruptOpen(System.currentTimeMillis()) ?: latest
                    }
                    if (latest?.state == GpsRecordingState.INTERRUPTED) {
                        latest = journal.stop(latest.id, System.currentTimeMillis())
                        call.resolve(latest.toStatus(GpsRecorderState.STOPPED).toJs())
                    } else {
                        call.resolve(latest.toStatus(
                            when (latest?.state) {
                                GpsRecordingState.STOPPED -> GpsRecorderState.STOPPED
                                else -> GpsRecorderState.IDLE
                            },
                        ).toJs())
                    }
                } finally {
                    journal.close()
                }
            } catch (_: Throwable) {
                call.resolve(GpsRecorderStatus(GpsRecorderState.STORAGE_ERROR, reason = "journal_error").toJs())
            }
        }
    }

    private fun requestStartPermissions(call: PluginCall, action: String, recordingId: String?) {
        if (GpsRecordingService.isActive()) {
            worker.execute {
                call.resolve((GpsRecordingService.activeStatus()
                    ?: GpsRecorderStatus(GpsRecorderState.SERVICE_ERROR, reason = "service_start_failed")).toJs())
            }
            return
        }
        if (!hasFinePermission()) {
            call.getData().put(OPERATION_KEY, action)
            if (recordingId != null) call.getData().put(RECORDING_ID_KEY, recordingId)
            requestPermissionForAlias("location", call, "locationPermissionCallback")
            return
        }
        requestNotificationPermissionIfNeeded(call, action, recordingId)
    }

    @PermissionCallback
    private fun locationPermissionCallback(call: PluginCall) {
        if (!hasFinePermission()) {
            call.resolve(GpsRecorderStatus(GpsRecorderState.PERMISSION_REQUIRED, reason = "fine_location_denied").toJs())
            return
        }
        val action = call.getString(OPERATION_KEY) ?: GpsRecordingService.ACTION_START
        requestNotificationPermissionIfNeeded(call, action, call.getString(RECORDING_ID_KEY))
    }

    @PermissionCallback
    private fun notificationPermissionCallback(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= 33 && !hasNotificationPermission()) {
            call.resolve(GpsRecorderStatus(GpsRecorderState.NOTIFICATION_REQUIRED, reason = "notifications_denied").toJs())
            return
        }
        // Permission callbacks preserve the requested operation in PluginCall data.
        val action = call.getString(OPERATION_KEY) ?: GpsRecordingService.ACTION_START
        val recordingId = call.getString(RECORDING_ID_KEY)
        startServiceForCall(call, action, recordingId)
    }

    private fun requestNotificationPermissionIfNeeded(call: PluginCall, action: String, recordingId: String?) {
        if (Build.VERSION.SDK_INT >= 33 && !hasNotificationPermission()) {
            call.getData().put(OPERATION_KEY, action)
            if (recordingId != null) call.getData().put(RECORDING_ID_KEY, recordingId)
            requestPermissionForAlias("notifications", call, "notificationPermissionCallback")
            return
        }
        startServiceForCall(call, action, recordingId)
    }

    private fun startServiceForCall(call: PluginCall, action: String, recordingId: String?) {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            call.resolve(GpsRecorderStatus(GpsRecorderState.LOCATION_OFF, reason = "location_disabled").toJs())
            return
        }
        if (manager.getProvider(LocationManager.GPS_PROVIDER) == null) {
            call.resolve(GpsRecorderStatus(GpsRecorderState.SERVICE_ERROR, reason = "provider_unavailable").toJs())
            return
        }
        worker.execute {
            try {
                val intent = Intent(context, GpsRecordingService::class.java).setAction(action)
                if (recordingId != null) intent.putExtra(GpsRecordingService.EXTRA_RECORDING_ID, recordingId)
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
                bindForStartup(call)
            } catch (_: IllegalStateException) {
                call.resolve(GpsRecorderStatus(GpsRecorderState.SERVICE_ERROR, reason = "service_start_failed").toJs())
            } catch (_: SecurityException) {
                call.resolve(GpsRecorderStatus(GpsRecorderState.PERMISSION_REQUIRED, reason = "fine_location_denied").toJs())
            } catch (_: Throwable) {
                call.resolve(GpsRecorderStatus(GpsRecorderState.SERVICE_ERROR, reason = "service_start_failed").toJs())
            }
        }
    }

    private fun bindForStartup(call: PluginCall) {
        val completed = AtomicBoolean(false)
        val mainHandler = Handler(Looper.getMainLooper())
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
                if (!completed.compareAndSet(false, true)) return
                mainHandler.removeCallbacksAndMessages(null)
                val service = (binder as? GpsRecordingService.LocalBinder)?.service()
                if (service == null) {
                    call.resolve(GpsRecorderStatus(GpsRecorderState.SERVICE_ERROR, reason = "service_start_failed").toJs())
                } else {
                    call.resolve(service.currentStatus().toJs())
                }
                try { context.unbindService(this) } catch (_: IllegalArgumentException) { }
            }

            override fun onServiceDisconnected(name: ComponentName?) = Unit
        }
        val timeout = Runnable {
            if (completed.compareAndSet(false, true)) {
                try { context.unbindService(connection) } catch (_: IllegalArgumentException) { }
                context.stopService(Intent(context, GpsRecordingService::class.java))
                worker.execute {
                    GpsRecordingService.stopActive()
                    call.resolve(GpsRecorderStatus(GpsRecorderState.SERVICE_ERROR, reason = "service_start_failed").toJs())
                }
            }
        }
        if (!context.bindService(Intent(context, GpsRecordingService::class.java), connection, Context.BIND_AUTO_CREATE)) {
            completed.set(true)
            call.resolve(GpsRecorderStatus(GpsRecorderState.SERVICE_ERROR, reason = "service_start_failed").toJs())
        } else {
            mainHandler.postDelayed(timeout, STARTUP_TIMEOUT_MS)
        }
    }

    private fun hasFinePermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun hasNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun GpsRecorderStatus.toJs(): JSObject = JSObject().apply {
        put("state", state)
        put("recordingId", recordingId ?: JSONObject.NULL)
        put("pointCount", pointCount)
        put("lastMeasuredAtMs", lastMeasuredAtMs ?: JSONObject.NULL)
        put("hash", hash ?: JSONObject.NULL)
        if (reason != null) put("reason", reason)
    }

    private fun se.otid.participant.gps.GpsSnapshot?.toStatus(state: String, reason: String? = null): GpsRecorderStatus =
        if (this == null) GpsRecorderStatus(state, reason = reason) else GpsRecorderStatus(
            state = state,
            recordingId = id,
            pointCount = pointCount,
            lastMeasuredAtMs = lastMeasuredAtMs,
            hash = hash,
            reason = reason,
        )

    companion object {
        private const val OPERATION_KEY = "gps_recorder_action"
        private const val RECORDING_ID_KEY = "gps_recorder_id"
        private const val STARTUP_TIMEOUT_MS = 8_000L
    }
}

package se.otid.participant

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Binder
import android.os.Build
import android.os.Bundle
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import se.otid.participant.gps.GpsJournal
import se.otid.participant.gps.GpsJournalFailure
import se.otid.participant.gps.GpsRecordingState
import se.otid.participant.gps.GpsSnapshot

/** User-started GPS foreground service. It never starts itself after process death. */
class GpsRecordingService : Service(), LocationListener {
    inner class LocalBinder : Binder() {
        fun service(): GpsRecordingService = this@GpsRecordingService
    }

    private val binder = LocalBinder()
    private val recordingLock = Any()
    private lateinit var locationManager: LocationManager
    private lateinit var journal: GpsJournal
    private var handlerThread: HandlerThread? = null
    private var snapshot: GpsSnapshot? = null
    @Volatile private var status = GpsRecorderStatus(GpsRecorderState.STARTING)
    @Volatile private var started = false
    private var lastFixElapsedNanos: Long? = null
    private var receivedAnyFix = false
    private var precisionBlocked = false

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        journal = GpsJournal(applicationContext)
        synchronized(activeLock) { activeService = this }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action != ACTION_START && action != ACTION_RESUME) {
            status = GpsRecorderStatus(GpsRecorderState.SERVICE_ERROR, reason = "service_start_failed")
            stopSelf(startId)
            return START_NOT_STICKY
        }

        // Two quick bridge calls may both reach startForegroundService before
        // onCreate makes this instance visible. A duplicate must not turn the
        // already-recording journal into an interrupted one.
        if (started) return START_NOT_STICKY

        status = GpsRecorderStatus(GpsRecorderState.STARTING)
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            } else {
                startForeground(NOTIFICATION_ID, buildNotification())
            }
            if (!hasPreciseLocationPermission()) {
                failBeforeRecording(GpsRecorderState.PERMISSION_REQUIRED, "fine_location_denied", startId)
                return START_NOT_STICKY
            }
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                failBeforeRecording(GpsRecorderState.NOTIFICATION_REQUIRED, "notifications_denied", startId)
                return START_NOT_STICKY
            }
            if (!locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                failBeforeRecording(GpsRecorderState.LOCATION_OFF, "location_disabled", startId)
                return START_NOT_STICKY
            }
            if (locationManager.getProvider(LocationManager.GPS_PROVIDER) == null) {
                failBeforeRecording(GpsRecorderState.SERVICE_ERROR, "provider_unavailable", startId)
                return START_NOT_STICKY
            }

            if (action == ACTION_START) {
                var latest = journal.latest()
                if (latest?.state == GpsRecordingState.RECORDING) {
                    latest = journal.interruptOpen(System.currentTimeMillis()) ?: latest
                }
                if (latest?.state == GpsRecordingState.INTERRUPTED) {
                    snapshot = latest
                    status = latest.toStatus(GpsRecorderState.INTERRUPTED, "service_interrupted")
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf(startId)
                    return START_NOT_STICKY
                }
            }

            snapshot = if (action == ACTION_RESUME) {
                val id = intent.getStringExtra(EXTRA_RECORDING_ID)
                    ?: throw IllegalArgumentException("Recording id saknas")
                journal.resume(id, System.currentTimeMillis())
            } else {
                journal.start(System.currentTimeMillis())
            }
            handlerThread = HandlerThread("otid-gps-location").also { it.start() }
            locationManager.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                LOCATION_INTERVAL_MS,
                0f,
                this,
                handlerThread!!.looper,
            )
            started = true
            status = GpsRecorderStatus(
                state = GpsRecorderState.WAITING_FIX,
                recordingId = snapshot?.id,
                pointCount = snapshot?.pointCount ?: 0,
                lastMeasuredAtMs = snapshot?.lastMeasuredAtMs,
                hash = snapshot?.hash,
                reason = "no_fix",
            )
        } catch (security: SecurityException) {
            failOpenRecording(GpsRecorderState.PERMISSION_REQUIRED, "fine_location_denied", startId)
        } catch (failure: Throwable) {
            val reason = if (failure is GpsJournalFailure) "journal_error" else "service_start_failed"
            failOpenRecording(
                if (reason == "journal_error") GpsRecorderState.STORAGE_ERROR else GpsRecorderState.SERVICE_ERROR,
                reason,
                startId,
            )
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        synchronized(recordingLock) {
            unregisterLocationUpdates()
            try {
                if (::journal.isInitialized) {
                    val interrupted = journal.interruptOpen(System.currentTimeMillis())
                    if (interrupted != null) snapshot = interrupted
                }
            } catch (_: Throwable) {
                status = status.copy(state = GpsRecorderState.STORAGE_ERROR, reason = "journal_error")
            }
            started = false
        }
        handlerThread?.quitSafely()
        handlerThread = null
        try {
            if (::journal.isInitialized) journal.close()
        } catch (_: Throwable) {
            status = status.copy(state = GpsRecorderState.STORAGE_ERROR, reason = "journal_error")
        } finally {
            synchronized(activeLock) {
                if (activeService === this) activeService = null
            }
        }
        super.onDestroy()
    }

    internal fun currentStatus(): GpsRecorderStatus {
        return synchronized(recordingLock) {
            try {
                refreshFixState()
            } catch (_: SecurityException) {
                status = status.copy(state = GpsRecorderState.PERMISSION_REQUIRED, reason = "fine_location_denied")
            } catch (_: RuntimeException) {
                status = status.copy(state = GpsRecorderState.SERVICE_ERROR, reason = "service_status_failed")
            }
            status
        }
    }

    internal fun stopRecording(): GpsRecorderStatus {
        return synchronized(recordingLock) {
            if (!started) return@synchronized status
            status = status.copy(state = GpsRecorderState.STOPPING, reason = null)
            unregisterLocationUpdates()
            try {
                val stopped = journal.stop(snapshot!!.id, System.currentTimeMillis())
                snapshot = stopped
                started = false
                status = stopped.toStatus(GpsRecorderState.STOPPED)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                status
            } catch (_: Throwable) {
                status = status.copy(state = GpsRecorderState.STORAGE_ERROR, reason = "journal_error")
                status
            }
        }
    }

    override fun onLocationChanged(location: Location) {
        synchronized(recordingLock) {
            if (!started || snapshot == null) return
            try {
                val nowElapsed = SystemClock.elapsedRealtimeNanos()
                val measuredElapsed = location.elapsedRealtimeNanos
                if (measuredElapsed <= 0L || measuredElapsed > nowElapsed ||
                    nowElapsed - measuredElapsed > MAX_FIX_AGE_NANOS
                ) {
                    receivedAnyFix = true
                    lastFixElapsedNanos = measuredElapsed.takeIf { it > 0L }
                    refreshFixState()
                    return
                }
                if (!location.hasAccuracy() || location.accuracy > MAX_ACCEPTED_ACCURACY_M) {
                    receivedAnyFix = true
                    precisionBlocked = true
                    status = status.copy(state = GpsRecorderState.WAITING_FIX, reason = "insufficient_accuracy")
                    return
                }
                snapshot = journal.append(
                    id = snapshot!!.id,
                    measuredAtMs = location.time,
                    latitude = location.latitude,
                    longitude = location.longitude,
                    accuracyM = location.accuracy,
                    elapsedRealtimeNanos = measuredElapsed,
                )
                receivedAnyFix = true
                lastFixElapsedNanos = measuredElapsed
                precisionBlocked = false
                status = snapshot!!.toStatus(GpsRecorderState.RECORDING)
            } catch (_: Throwable) {
                unregisterLocationUpdates()
                try {
                    val interrupted = journal.interruptOpen(System.currentTimeMillis())
                    if (interrupted != null) snapshot = interrupted
                } catch (_: Throwable) {
                    // Preserve the storage failure as the user-visible reason.
                }
                started = false
                status = status.copy(state = GpsRecorderState.STORAGE_ERROR, reason = "journal_error")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }

    @Deprecated("Deprecated by Android; required by LocationListener on older API levels")
    override fun onStatusChanged(provider: String?, providerStatus: Int, extras: Bundle?) = Unit
    override fun onProviderEnabled(provider: String) = Unit
    override fun onProviderDisabled(provider: String) {
        synchronized(recordingLock) {
            if (provider == LocationManager.GPS_PROVIDER && started) {
                status = status.copy(state = GpsRecorderState.LOCATION_OFF, reason = "location_disabled")
            }
        }
    }

    private fun refreshFixState() {
        if (!started || status.state == GpsRecorderState.STORAGE_ERROR) return
        if (!hasPreciseLocationPermission()) {
            status = status.copy(state = GpsRecorderState.PERMISSION_REQUIRED, reason = "fine_location_denied")
            return
        }
        if (!locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            status = status.copy(state = GpsRecorderState.LOCATION_OFF, reason = "location_disabled")
            return
        }
        val fixElapsed = lastFixElapsedNanos
        val nowElapsed = SystemClock.elapsedRealtimeNanos()
        val fresh = !precisionBlocked && fixElapsed != null && fixElapsed <= nowElapsed &&
            nowElapsed - fixElapsed <= MAX_FIX_AGE_NANOS
        if (fresh && snapshot != null) {
            status = snapshot!!.toStatus(GpsRecorderState.RECORDING)
        } else {
            val state = if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                GpsRecorderState.WAITING_FIX
            } else {
                GpsRecorderState.LOCATION_OFF
            }
            val reason = when {
                precisionBlocked -> "insufficient_accuracy"
                receivedAnyFix -> "stale_fix"
                else -> "no_fix"
            }
            status = status.copy(state = state, reason = reason)
        }
    }

    private fun failBeforeRecording(state: String, reason: String, startId: Int) {
        status = snapshot?.toStatus(state, reason) ?: GpsRecorderStatus(state, reason = reason)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf(startId)
    }

    private fun failOpenRecording(state: String, reason: String, startId: Int) {
        try {
            if (::journal.isInitialized) {
                val interrupted = journal.interruptOpen(System.currentTimeMillis())
                if (interrupted != null) snapshot = interrupted
            }
        } catch (_: Throwable) {
            // The original failure remains the visible state.
        }
        started = false
        status = snapshot?.toStatus(state, reason) ?: GpsRecorderStatus(state, reason = reason)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf(startId)
    }

    private fun unregisterLocationUpdates() {
        if (::locationManager.isInitialized) {
            try {
                locationManager.removeUpdates(this)
            } catch (_: SecurityException) {
                // The listener is no longer useful after permission revocation.
            }
        }
    }

    private fun hasPreciseLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun buildNotification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "GPS-inspelning", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Visar när O-Tid samlar in GPS-punkter"
                },
            )
        }
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = launchIntent?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0,
            )
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("GPS-inspelning pågår")
            .setContentText("O-Tid sparar position lokalt på telefonen")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun GpsSnapshot.toStatus(state: String, reason: String? = null) = GpsRecorderStatus(
        state = state,
        recordingId = id,
        pointCount = pointCount,
        lastMeasuredAtMs = lastMeasuredAtMs,
        hash = hash,
        reason = reason,
    )

    companion object {
        const val ACTION_START = "se.otid.participant.action.GPS_START"
        const val ACTION_RESUME = "se.otid.participant.action.GPS_RESUME"
        const val EXTRA_RECORDING_ID = "recording_id"
        private const val CHANNEL_ID = "gps_recording"
        private const val NOTIFICATION_ID = 158
        private const val LOCATION_INTERVAL_MS = 1_000L
        private const val MAX_FIX_AGE_NANOS = 15_000_000_000L
        private const val MAX_ACCEPTED_ACCURACY_M = 100f
        private val activeLock = Any()
        @Volatile private var activeService: GpsRecordingService? = null

        internal fun activeStatus(): GpsRecorderStatus? =
            synchronized(activeLock) { activeService }?.currentStatus()

        internal fun stopActive(): GpsRecorderStatus? =
            synchronized(activeLock) { activeService }?.stopRecording()

        internal fun isActive(): Boolean = synchronized(activeLock) { activeService != null }
    }
}

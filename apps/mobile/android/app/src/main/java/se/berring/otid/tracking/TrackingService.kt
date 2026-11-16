package se.berring.otid.tracking

import android.Manifest
import android.app.AlarmManager
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
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import se.berring.otid.MainActivity
import se.berring.otid.R
import java.io.IOException

/**
 * Förgrundstjänst av typen location under ett lopp (ADR-0227 beslut 4). GPS med cirka 1 s intervall.
 * Startar aldrig om sig själv (START_NOT_STICKY): dör tjänsten är loppet stoppat av systemet.
 */
class TrackingService : Service(), LocationListener {

    companion object {
        const val ACTION_START = "se.berring.otid.tracking.START"
        const val ACTION_DEADLINE = "se.berring.otid.tracking.DEADLINE"
        const val EXTRA_SESSION_ID = "sessionId"
        private const val CHANNEL_ID = "otid-tracking"
        private const val NOTIFICATION_ID = 4711
        private const val INTERVAL_MS = 1000L
        private const val TAG = "OTidTracking"

        /** Sant medan tjänsten tar emot positioner i den här processen. */
        @Volatile
        var running: Boolean = false
            private set

        @Volatile
        private var instance: TrackingService? = null

        /** Stoppar en pågående spårning i den här processen. Falskt om ingen tjänst kör. */
        fun requestStop(reason: String): Boolean {
            val service = instance ?: return false
            service.mainHandler.post { service.stopTracking(reason) }
            return true
        }
    }

    // Läses också av GPS-tråden.
    @Volatile
    private var sessionId: String? = null
    @Volatile
    private var stopAtMs: Long = 0
    private var stopReason: String? = null
    private var locationThread: HandlerThread? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val deadlineCheck = Runnable { checkDeadline() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startTracking(intent.getStringExtra(EXTRA_SESSION_ID))
            ACTION_DEADLINE -> checkDeadline()
            else -> {
                // Okänd start (t.ex. systemet utan intent): spåra inte.
                Log.w(TAG, "Tjänsten startades utan känd handling (${intent?.action}); stoppar")
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    override fun onCreate() {
        super.onCreate()
        TrackingStore.init(this)
        instance = this
    }

    private fun startTracking(requested: String?) {
        val state = try {
            TrackingStore.state()
        } catch (e: Exception) {
            Log.e(TAG, "Kunde inte läsa spårningens läge", e)
            null
        }
        // startForeground först: en tjänst som startats med startForegroundService måste anropa den även när
        // starten sedan avbryts, annars stänger Android appen.
        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(state?.title ?: "O-Tid", state?.text ?: ""),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
            )
        } catch (e: Exception) {
            // SecurityException eller ForegroundServiceStartNotAllowedException (appen syntes inte).
            failStart(requested, "Telefonen tillät inte spårningstjänsten: ${e.message}")
            return
        }
        if (requested == null || state == null || state.sessionId != requested || !state.active) {
            failStart(requested, "Loppet som skulle spåras finns inte sparat")
            return
        }
        val current = sessionId
        if (current != null && current != requested) {
            failStart(null, "Spårning pågår redan för ett annat lopp")
            TrackingStore.reportStart(requested, "Spårning pågår redan för ett annat lopp")
            return
        }
        stopAtMs = state.stopAtMs
        scheduleDeadline()
        if (current == null) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                failStart(requested, "Appen har inte tillstånd till exakt plats")
                return
            }
            val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val thread = HandlerThread("otid-location").also { it.start() }
            locationThread = thread
            // sessionId sätts före första punkten kan komma.
            sessionId = requested
            try {
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, INTERVAL_MS, 0f, this, thread.looper)
            } catch (e: Exception) {
                sessionId = null
                failStart(requested, "Kunde inte starta GPS: ${e.message}")
                return
            }
            running = true
        }
        TrackingStore.reportStart(requested, null)
    }

    private fun failStart(requested: String?, message: String) {
        Log.e(TAG, message)
        if (requested != null) {
            TrackingStore.reportStart(requested, message)
            runCatchingLogged { TrackingStore.markStopped(requested, "system") }
        }
        // En pågående spårning för ett annat lopp får fortsätta.
        if (sessionId == null) stopTracking("system")
    }

    private fun buildNotification(title: String, text: String) = run {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Spårning under lopp", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Visas medan O-Tid följer din position under ett lopp."
                }
            )
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_otid)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    // Tre vägar till maxtiden: timer i processen, larm som väcker telefonen och kontroll vid varje punkt.
    private fun scheduleDeadline() {
        mainHandler.removeCallbacks(deadlineCheck)
        mainHandler.postDelayed(deadlineCheck, (stopAtMs - System.currentTimeMillis()).coerceAtLeast(0))
        val alarms = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, stopAtMs, deadlineIntent())
    }

    private fun deadlineIntent(): PendingIntent = PendingIntent.getService(
        this, 1, Intent(this, TrackingService::class.java).setAction(ACTION_DEADLINE),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    private fun checkDeadline() {
        if (sessionId == null) {
            stopSelf()
            return
        }
        val left = stopAtMs - System.currentTimeMillis()
        if (left <= 0) {
            stopTracking("deadline")
        } else {
            mainHandler.removeCallbacks(deadlineCheck)
            mainHandler.postDelayed(deadlineCheck, left)
        }
    }

    private fun stopTracking(reason: String) {
        if (stopReason == null) stopReason = reason
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onLocationChanged(location: Location) {
        val id = sessionId ?: return
        val now = System.currentTimeMillis()
        if (now >= stopAtMs) {
            mainHandler.post { stopTracking("deadline") }
            return
        }
        try {
            TrackingStore.append(
                id,
                location.latitude,
                location.longitude,
                if (location.hasAccuracy()) location.accuracy.toDouble() else null,
                location.time,
                now
            )
        } catch (e: IOException) {
            // Utan journal finns ingen säker punkt att lämna; spårningen stoppas synligt.
            Log.e(TAG, "Kunde inte skriva punkten till journalen", e)
            mainHandler.post { stopTracking("system") }
        }
    }

    // Plats avstängd i telefonen: appen spårar inte längre (ADR-0151, behålls i ADR-0227 beslut 3).
    override fun onProviderDisabled(provider: String) {
        Log.w(TAG, "Platstjänsten stängdes av ($provider)")
        mainHandler.post { stopTracking("system") }
    }

    override fun onProviderEnabled(provider: String) {}

    // Krävs på Android 10 och äldre, där metoden saknar standardkropp i gränssnittet.
    @Deprecated("Anropas bara av äldre Android")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

    override fun onDestroy() {
        mainHandler.removeCallbacks(deadlineCheck)
        (getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(deadlineIntent())
        (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(this)
        locationThread?.quitSafely()
        locationThread = null
        running = false
        instance = null
        val id = sessionId
        sessionId = null
        if (id != null) {
            // Ingen egen orsak betyder att systemet stängde tjänsten.
            runCatchingLogged { TrackingStore.markStopped(id, stopReason ?: "system") }
        }
        super.onDestroy()
    }

    private inline fun runCatchingLogged(block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            Log.e(TAG, "Kunde inte spara att spårningen stoppades", e)
        }
    }
}

package se.berring.otid.tracking

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Bryggan `window.Capacitor.Plugins.OTidTracking` (ADR-0227 beslut 2). Metodnamn, fält och händelser följer
 * kontraktet exakt; ändras de krävs en ny appversion och ett tillägg i ADR-0227.
 */
@CapacitorPlugin(
    name = "OTidTracking",
    permissions = [
        Permission(alias = "fineLocation", strings = [Manifest.permission.ACCESS_FINE_LOCATION]),
        Permission(alias = "coarseLocation", strings = [Manifest.permission.ACCESS_COARSE_LOCATION]),
        Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])
    ]
)
class OTidTrackingPlugin : Plugin(), TrackingListener {

    companion object {
        private const val FORMAT_VERSION = 1
        private const val MAX_READ = 2000
        private const val START_TIMEOUT_MS = 10_000L
        private const val TAG = "OTidTracking"
    }

    private val pendingStarts = ConcurrentHashMap<String, PluginCall>()
    private val main = Handler(Looper.getMainLooper())
    private lateinit var network: ExecutorService
    private var loadError: String? = null

    override fun load() {
        network = Executors.newSingleThreadExecutor()
        try {
            TrackingStore.init(context)
            TrackingStore.addListener(this)
            // Har processen dött under ett lopp finns ingen tjänst: då stoppade systemet spårningen.
            val state = TrackingStore.state()
            if (state != null && state.active && !TrackingService.running) {
                TrackingStore.markStopped(state.sessionId, "system")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Journalen kunde inte öppnas", e)
            loadError = "Journalen kunde inte öppnas: ${e.message}"
        }
    }

    override fun handleOnDestroy() {
        TrackingStore.removeListener(this)
        network.shutdown()
    }

    // Alla metoder: fel blir avvisade anrop med begriplig text, aldrig tysta.
    private inline fun guarded(call: PluginCall, block: () -> Unit) {
        loadError?.let {
            call.reject(it)
            return
        }
        try {
            block()
        } catch (e: Exception) {
            Log.e(TAG, "${call.methodName} misslyckades", e)
            call.reject("${call.methodName} misslyckades: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    private fun requiredString(call: PluginCall, name: String): String? {
        val value = call.getString(name)
        if (value.isNullOrBlank()) {
            call.reject("$name saknas")
            return null
        }
        return value
    }

    private fun longOption(call: PluginCall, name: String): Long? = (call.data.opt(name) as? Number)?.toLong()

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun stateText(state: PermissionState?): String = when (state) {
        PermissionState.GRANTED -> "granted"
        PermissionState.DENIED -> "denied"
        else -> "prompt"
    }

    private fun permissionResult(): JSObject {
        val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        val location = if (fine || coarse) "granted" else stateText(getPermissionState("fineLocation"))
        val notifications = when {
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ->
                if (NotificationManagerCompat.from(context).areNotificationsEnabled()) "granted" else "denied"
            granted(Manifest.permission.POST_NOTIFICATIONS) -> "granted"
            else -> stateText(getPermissionState("notifications"))
        }
        return JSObject().put("location", location).put("precise", fine).put("notifications", notifications)
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) = guarded(call) {
        val aliases = mutableListOf<String>()
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) aliases += listOf("fineLocation", "coarseLocation")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
            aliases += "notifications"
        }
        if (aliases.isEmpty()) {
            call.resolve(permissionResult())
        } else {
            requestPermissionForAliases(aliases.toTypedArray(), call, "permissionCallback")
        }
    }

    @PermissionCallback
    private fun permissionCallback(call: PluginCall) = guarded(call) {
        call.resolve(permissionResult())
    }

    // Capacitor sätter detta i BridgeActivity.onResume och tar bort det i onStop.
    private fun appIsVisible(): Boolean = bridge.app.isActive

    @PluginMethod
    fun start(call: PluginCall) = guarded(call) {
        val sessionId = requiredString(call, "sessionId") ?: return@guarded
        val title = requiredString(call, "title") ?: return@guarded
        val text = call.getString("text") ?: run {
            call.reject("text saknas")
            return@guarded
        }
        val stopAtMs = longOption(call, "stopAtMs") ?: run {
            call.reject("stopAtMs saknas")
            return@guarded
        }
        if (stopAtMs <= System.currentTimeMillis()) return@guarded call.reject("Maxtiden har redan passerat")
        if (!appIsVisible()) return@guarded call.reject("Appen måste synas när spårningen startas")
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            return@guarded call.reject("Appen har inte tillstånd till exakt plats")
        }
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        if (!LocationManagerCompat.isLocationEnabled(locationManager) ||
            !locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
        ) {
            return@guarded call.reject("Platstjänsten är avstängd i telefonen")
        }
        val current = TrackingStore.state()
        if (current != null && current.active && TrackingService.running && current.sessionId != sessionId) {
            return@guarded call.reject("Spårning pågår redan för ett annat lopp")
        }
        if (pendingStarts.putIfAbsent(sessionId, call) != null) {
            return@guarded call.reject("Spårningen håller redan på att starta")
        }
        try {
            TrackingStore.saveState(SessionState(sessionId, stopAtMs, title, text, active = true, stoppedBy = null))
            val intent = Intent(context, TrackingService::class.java)
                .setAction(TrackingService.ACTION_START)
                .putExtra(TrackingService.EXTRA_SESSION_ID, sessionId)
            ContextCompat.startForegroundService(context, intent)
        } catch (e: Exception) {
            pendingStarts.remove(sessionId)
            TrackingStore.markStopped(sessionId, "system")
            throw e
        }
        main.postDelayed({
            pendingStarts.remove(sessionId)?.reject("Spårtjänsten startade inte inom 10 s")
        }, START_TIMEOUT_MS)
    }

    override fun onStartResult(sessionId: String, error: String?) {
        val call = pendingStarts.remove(sessionId) ?: return
        if (error != null) {
            call.reject(error)
            return
        }
        guarded(call) { call.resolve(JSObject().put("lastSeq", TrackingStore.lastSeq(sessionId))) }
    }

    @PluginMethod
    fun stop(call: PluginCall) = guarded(call) {
        val sessionId = requiredString(call, "sessionId") ?: return@guarded
        val state = TrackingStore.state()
        if (state != null && state.sessionId == sessionId && state.active) {
            // Läget sparas först, så att status() direkt visar stoppat; tjänsten stängs strax efter.
            TrackingStore.markStopped(sessionId, "user")
            TrackingService.requestStop("user")
        }
        call.resolve()
    }

    @PluginMethod
    fun status(call: PluginCall) = guarded(call) {
        val state = TrackingStore.state()
        val result = JSObject()
            .put("formatVersion", FORMAT_VERSION)
            .put("tracking", state != null && state.active && TrackingService.running)
            .put("sessionId", state?.sessionId ?: JSONObject.NULL)
            .put("lastSeq", if (state == null) 0L else TrackingStore.lastSeq(state.sessionId))
            .put("stopAtMs", state?.stopAtMs ?: JSONObject.NULL)
            .put("stoppedBy", state?.stoppedBy ?: JSONObject.NULL)
        call.resolve(result)
    }

    @PluginMethod
    fun read(call: PluginCall) = guarded(call) {
        val sessionId = requiredString(call, "sessionId") ?: return@guarded
        val afterSeq = longOption(call, "afterSeq") ?: 0L
        val limit = (longOption(call, "limit") ?: MAX_READ.toLong()).coerceIn(0L, MAX_READ.toLong()).toInt()
        val (fixes, lastSeq) = TrackingStore.read(sessionId, afterSeq, limit)
        val array = JSArray()
        fixes.forEach { array.put(it.toJson()) }
        call.resolve(JSObject().put("fixes", array).put("lastSeq", lastSeq))
    }

    @PluginMethod
    fun purge(call: PluginCall) = guarded(call) {
        val sessionId = requiredString(call, "sessionId") ?: return@guarded
        val state = TrackingStore.state()
        if (state != null && state.sessionId == sessionId && state.active) {
            return@guarded call.reject("Spårningen pågår; stoppa den innan journalen tas bort")
        }
        TrackingStore.purge(sessionId)
        call.resolve()
    }

    @PluginMethod
    fun post(call: PluginCall) = guarded(call) {
        val url = requiredString(call, "url") ?: return@guarded
        val body = call.getString("body") ?: return@guarded call.reject("body saknas (JSON som text)")
        val serverUrl = bridge.serverUrl ?: return@guarded call.reject("Appen saknar serveradress (server.url)")
        // Kontrollera adressen direkt, så att fel adress avvisas utan nätanrop.
        NativePost.resolve(serverUrl, url)
        network.execute {
            try {
                val result = NativePost.send(serverUrl, url, body)
                call.resolve(JSObject().put("status", result.status).put("body", result.body))
            } catch (e: Exception) {
                Log.w(TAG, "post misslyckades", e)
                call.reject(e.message ?: "Kunde inte nå servern")
            }
        }
    }

    @PluginMethod
    fun signal(call: PluginCall) = guarded(call) {
        val kind = call.getString("kind")
        if (kind != "ok") return@guarded call.reject("Okänd signal: $kind")
        main.post {
            try {
                Signal.ok(context)
                call.resolve()
            } catch (e: Exception) {
                Log.w(TAG, "signal misslyckades", e)
                call.reject("Signalen kunde inte ges: ${e.message}")
            }
        }
    }

    override fun onFix(fix: Fix) {
        notifyListeners("fix", JSObject.fromJSONObject(fix.toJson()))
    }

    override fun onStopped(sessionId: String, stoppedBy: String) {
        notifyListeners("stopped", JSObject().put("sessionId", sessionId).put("stoppedBy", stoppedBy))
    }
}

package se.otid.participant

/** Public native-to-web state names. Keep these stable for the Capacitor bridge. */
internal object GpsRecorderState {
    const val IDLE = "IDLE"
    const val STARTING = "STARTING"
    const val WAITING_FIX = "WAITING_FIX"
    const val RECORDING = "RECORDING"
    const val INTERRUPTED = "INTERRUPTED"
    const val STOPPING = "STOPPING"
    const val STOPPED = "STOPPED"
    const val PERMISSION_REQUIRED = "PERMISSION_REQUIRED"
    const val NOTIFICATION_REQUIRED = "NOTIFICATION_REQUIRED"
    const val LOCATION_OFF = "LOCATION_OFF"
    const val STORAGE_ERROR = "STORAGE_ERROR"
    const val SERVICE_ERROR = "SERVICE_ERROR"
}

internal data class GpsRecorderStatus(
    val state: String,
    val recordingId: String? = null,
    val pointCount: Int = 0,
    val lastMeasuredAtMs: Long? = null,
    val hash: String? = null,
    val reason: String? = null,
)

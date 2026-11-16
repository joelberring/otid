package se.berring.otid.tracking

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArraySet

/** Loppets läge som överlever att appen startas om. `active` betyder att spårningen ska pågå. */
data class SessionState(
    val sessionId: String,
    val stopAtMs: Long,
    val title: String,
    val text: String,
    val active: Boolean,
    val stoppedBy: String?
) {
    fun toJson(): JSONObject = JSONObject()
        .put("sessionId", sessionId)
        .put("stopAtMs", stopAtMs)
        .put("title", title)
        .put("text", text)
        .put("active", active)
        .put("stoppedBy", stoppedBy ?: JSONObject.NULL)

    companion object {
        fun fromJson(json: JSONObject) = SessionState(
            sessionId = json.getString("sessionId"),
            stopAtMs = json.getLong("stopAtMs"),
            title = json.getString("title"),
            text = json.getString("text"),
            active = json.getBoolean("active"),
            stoppedBy = if (json.isNull("stoppedBy")) null else json.getString("stoppedBy")
        )
    }
}

interface TrackingListener {
    fun onFix(fix: Fix)
    fun onStopped(sessionId: String, stoppedBy: String)
    fun onStartResult(sessionId: String, error: String?)
}

/**
 * Journaler och loppets läge på disk, delat av pluginen och tjänsten (samma process).
 * Allt ligger i noBackupFilesDir, som aldrig ingår i säkerhetskopian.
 */
object TrackingStore {
    private lateinit var dir: File
    private var journal: TrackingJournal? = null
    private var journalSessionId: String? = null
    private val listeners = CopyOnWriteArraySet<TrackingListener>()

    @Synchronized
    fun init(context: Context) {
        if (::dir.isInitialized) return
        dir = File(context.applicationContext.noBackupFilesDir, "otid-tracking")
        if (!dir.isDirectory && !dir.mkdirs()) throw IOException("Kunde inte skapa katalogen för journalen")
    }

    fun addListener(listener: TrackingListener) = listeners.add(listener)
    fun removeListener(listener: TrackingListener) = listeners.remove(listener)

    // Filnamn ur en hash, så att sessionId aldrig blir en sökväg.
    private fun baseName(sessionId: String): String =
        MessageDigest.getInstance("SHA-256").digest(sessionId.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private fun journalFile(sessionId: String) = File(dir, baseName(sessionId) + ".jsonl")
    private val stateFile get() = File(dir, "state.json")

    @Synchronized
    fun state(): SessionState? {
        val file = stateFile
        if (!file.exists()) return null
        return SessionState.fromJson(JSONObject(file.readText(Charsets.UTF_8)))
    }

    @Synchronized
    fun saveState(state: SessionState?) {
        if (state == null) {
            if (stateFile.exists() && !stateFile.delete()) throw IOException("Kunde inte ta bort spårningens läge")
            return
        }
        // Skriv till en temporär fil och byt namn, så att läget aldrig blir halvskrivet.
        val tmp = File(dir, "state.json.tmp")
        FileOutputStream(tmp).use {
            it.write(state.toJson().toString().toByteArray(Charsets.UTF_8))
            it.flush()
            it.fd.sync()
        }
        if (!tmp.renameTo(stateFile)) throw IOException("Kunde inte spara spårningens läge")
    }

    @Synchronized
    private fun openJournal(sessionId: String): TrackingJournal {
        val current = journal
        if (current != null && journalSessionId == sessionId) return current
        current?.close()
        val opened = TrackingJournal(journalFile(sessionId))
        journal = opened
        journalSessionId = sessionId
        return opened
    }

    @Synchronized
    fun lastSeq(sessionId: String): Long =
        if (journalSessionId == sessionId || journalFile(sessionId).exists()) openJournal(sessionId).lastSeq else 0

    /** Skriver punkten till disk och lämnar den sedan till lyssnarna. */
    fun append(sessionId: String, latitude: Double, longitude: Double, accuracyM: Double?, t: Long, receivedAt: Long): Fix {
        val fix = synchronized(this) { openJournal(sessionId).append(latitude, longitude, accuracyM, t, receivedAt) }
        listeners.forEach { it.onFix(fix) }
        return fix
    }

    @Synchronized
    fun read(sessionId: String, afterSeq: Long, limit: Int): Pair<List<Fix>, Long> {
        if (journalSessionId != sessionId && !journalFile(sessionId).exists()) return Pair(emptyList(), 0L)
        val opened = openJournal(sessionId)
        return Pair(opened.read(afterSeq, limit), opened.lastSeq)
    }

    @Synchronized
    fun purge(sessionId: String) {
        if (journalSessionId == sessionId) {
            journal?.close()
            journal = null
            journalSessionId = null
        }
        val file = journalFile(sessionId)
        if (file.exists() && !file.delete()) throw IOException("Kunde inte ta bort journalen")
        if (state()?.sessionId == sessionId) saveState(null)
    }

    /** Markerar loppet som stoppat och meddelar lyssnarna. Gör inget om det redan är stoppat. */
    fun markStopped(sessionId: String, stoppedBy: String) {
        val changed = synchronized(this) {
            val current = state()
            if (current == null || current.sessionId != sessionId || !current.active) {
                false
            } else {
                saveState(current.copy(active = false, stoppedBy = stoppedBy))
                true
            }
        }
        if (changed) listeners.forEach { it.onStopped(sessionId, stoppedBy) }
    }

    fun reportStart(sessionId: String, error: String?) {
        listeners.forEach { it.onStartResult(sessionId, error) }
    }
}

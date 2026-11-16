package se.berring.otid.tracking

import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile

/** En punkt i journalen, med fälten i bryggans kontrakt (ADR-0227 beslut 2). */
data class Fix(
    val seq: Long,
    val latitude: Double,
    val longitude: Double,
    val accuracyM: Double?,
    val t: Long,
    val receivedAt: Long
) {
    fun toJson(): JSONObject = JSONObject()
        .put("seq", seq)
        .put("latitude", latitude)
        .put("longitude", longitude)
        .put("accuracyM", accuracyM ?: JSONObject.NULL)
        .put("t", t)
        .put("receivedAt", receivedAt)

    companion object {
        fun fromJson(json: JSONObject): Fix = Fix(
            seq = json.getLong("seq"),
            latitude = json.getDouble("latitude"),
            longitude = json.getDouble("longitude"),
            accuracyM = if (json.isNull("accuracyM")) null else json.getDouble("accuracyM"),
            t = json.getLong("t"),
            receivedAt = json.getLong("receivedAt")
        )
    }
}

/**
 * Journal för ett lopp: en JSON-rad per punkt, synkad till disk (fsync) innan punkten lämnas vidare.
 * En halvskriven sista rad efter ett avbrott kapas när journalen öppnas. Inte trådsäker; TrackingStore låser.
 */
class TrackingJournal(private val file: File) {
    var lastSeq: Long = 0
        private set
    private var out: FileOutputStream? = null

    init {
        lastSeq = recover()
    }

    private fun recover(): Long {
        if (!file.exists()) return 0
        val bytes = file.readBytes()
        val end = bytes.lastIndexOf('\n'.code.toByte()) + 1
        if (end < bytes.size) {
            // Avbrott mitt i en skrivning: resten efter sista radslutet är ingen hel punkt.
            RandomAccessFile(file, "rw").use { it.setLength(end.toLong()) }
        }
        if (end == 0) return 0
        val text = String(bytes, 0, end, Charsets.UTF_8).trimEnd('\n')
        val lastLine = text.substringAfterLast('\n')
        return try {
            JSONObject(lastLine).getLong("seq")
        } catch (e: JSONException) {
            throw IOException("Journalen ${file.name} har en trasig rad: ${e.message}", e)
        }
    }

    fun append(latitude: Double, longitude: Double, accuracyM: Double?, t: Long, receivedAt: Long): Fix {
        val fix = Fix(lastSeq + 1, latitude, longitude, accuracyM, t, receivedAt)
        val stream = out ?: FileOutputStream(file, true).also { out = it }
        stream.write((fix.toJson().toString() + "\n").toByteArray(Charsets.UTF_8))
        stream.flush()
        stream.fd.sync()
        lastSeq = fix.seq
        return fix
    }

    fun read(afterSeq: Long, limit: Int): List<Fix> {
        if (!file.exists() || limit <= 0) return emptyList()
        val result = ArrayList<Fix>(minOf(limit, 256))
        file.bufferedReader(Charsets.UTF_8).useLines { lines ->
            for (line in lines) {
                if (line.isEmpty()) continue
                val fix = try {
                    Fix.fromJson(JSONObject(line))
                } catch (e: JSONException) {
                    throw IOException("Journalen ${file.name} har en trasig rad: ${e.message}", e)
                }
                if (fix.seq <= afterSeq) continue
                result.add(fix)
                if (result.size >= limit) break
            }
        }
        return result
    }

    fun close() {
        out?.close()
        out = null
    }
}

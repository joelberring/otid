package se.berring.otid.tracking

import android.os.Handler
import android.os.Looper
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

/** Svar från `post`: statuskod och kropp som text. */
data class PostResult(val status: Int, val body: String)

/**
 * POST från den inbyggda sidan i stället för webbvyn, som Android stryper i bakgrunden (ADR-0227 beslut 3).
 * Bara adresser under appens serveradress; Origin sätts till serverns ursprung. Inga kakor.
 */
object NativePost {
    private const val TIMEOUT_MS = 15_000

    /** Löser `url` mot serveradressen och kastar om den hamnar utanför. */
    fun resolve(serverUrl: String, url: String): URL {
        val base = URL(serverUrl)
        val target = URL(base, url)
        val basePath = base.path.ifEmpty { "/" }.let { if (it.endsWith("/")) it else "$it/" }
        val samePlace = target.protocol == base.protocol && target.host.equals(base.host, ignoreCase = true) &&
            target.port == base.port && (target.path + "/").startsWith(basePath)
        if (!samePlace) throw IllegalArgumentException("Adressen ligger inte under appens serveradress ($serverUrl)")
        return target
    }

    fun origin(serverUrl: String): String {
        val base = URL(serverUrl)
        return if (base.port == -1) "${base.protocol}://${base.host}" else "${base.protocol}://${base.host}:${base.port}"
    }

    /** Blockerar; anropas från en egen tråd. Hela anropet avbryts efter 15 s. */
    fun send(serverUrl: String, url: String, body: String): PostResult {
        val target = resolve(serverUrl, url)
        val connection = target.openConnection() as HttpURLConnection
        val watchdog = Handler(Looper.getMainLooper())
        val timedOut = AtomicBoolean(false)
        val abort = Runnable {
            timedOut.set(true)
            connection.disconnect()
        }
        watchdog.postDelayed(abort, TIMEOUT_MS.toLong())
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.doOutput = true
            connection.setRequestProperty("content-type", "application/json")
            connection.setRequestProperty("origin", origin(serverUrl))
            val bytes = body.toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return PostResult(status, text)
        } catch (e: IOException) {
            if (timedOut.get()) throw IOException("Servern svarade inte inom 15 s", e)
            throw IOException("Kunde inte nå servern: ${e.message}", e)
        } finally {
            watchdog.removeCallbacks(abort)
            connection.disconnect()
        }
    }
}

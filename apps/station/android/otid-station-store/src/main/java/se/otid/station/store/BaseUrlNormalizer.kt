package se.otid.station.store

import java.net.URI
import java.net.URISyntaxException
import java.util.Locale

object BaseUrlNormalizer {
    fun normalize(value: String): String {
        if (value.isBlank() || value.length > StationStoreLimits.MAX_BASE_URL_LENGTH || value.trim() != value) {
            fail()
        }
        val parsed = try {
            URI(value).normalize()
        } catch (failure: URISyntaxException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_ARGUMENT, "Serveradressen är ogiltig", failure)
        }
        if (!parsed.isAbsolute || parsed.isOpaque || parsed.userInfo != null ||
            parsed.query != null || parsed.fragment != null
        ) {
            fail()
        }
        val scheme = parsed.scheme?.lowercase(Locale.ROOT) ?: fail()
        val host = parsed.host?.lowercase(Locale.ROOT)?.removeSurrounding("[", "]") ?: fail()
        if (scheme != "https" && !(scheme == "http" && host in LOOPBACK_HOSTS)) fail()
        if (parsed.port !in -1..65_535) fail()
        val port = when {
            scheme == "https" && parsed.port == 443 -> -1
            scheme == "http" && parsed.port == 80 -> -1
            else -> parsed.port
        }
        val path = (parsed.path.takeUnless { it.isNullOrEmpty() } ?: "/").let {
            if (it.endsWith('/')) it else "$it/"
        }
        return try {
            URI(scheme, null, host, port, path, null, null).toASCIIString()
        } catch (failure: URISyntaxException) {
            throw StationStoreFailure(StationStoreErrors.INVALID_ARGUMENT, "Serveradressen är ogiltig", failure)
        }
    }

    private fun fail(): Nothing = throw StationStoreFailure(
        StationStoreErrors.INVALID_ARGUMENT,
        "Serveradressen måste använda HTTPS eller loopback-HTTP",
    )

    private val LOOPBACK_HOSTS = setOf("localhost", "127.0.0.1")
}

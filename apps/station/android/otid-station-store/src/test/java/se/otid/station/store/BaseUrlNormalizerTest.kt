package se.otid.station.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BaseUrlNormalizerTest {
    @Test
    fun normalizesSecureAndLoopbackUrls() {
        assertEquals("https://example.test/", BaseUrlNormalizer.normalize("HTTPS://Example.Test:443"))
        assertEquals("https://example.test/otid/", BaseUrlNormalizer.normalize("https://example.test/a/../otid"))
        assertEquals("http://localhost:3000/", BaseUrlNormalizer.normalize("http://LOCALHOST:3000"))
    }

    @Test
    fun rejectsInsecureRemoteAndCredentialBearingUrls() {
        listOf(
            "http://example.test/",
            "http://[::1]/",
            "https://user:secret@example.test/",
            "https://example.test/?token=secret",
            "https://example.test/#fragment",
            " https://example.test/",
            "relative/path",
        ).forEach { value ->
            val failure = assertThrows(StationStoreFailure::class.java) {
                BaseUrlNormalizer.normalize(value)
            }
            assertEquals(StationStoreErrors.INVALID_ARGUMENT, failure.code)
        }
    }
}

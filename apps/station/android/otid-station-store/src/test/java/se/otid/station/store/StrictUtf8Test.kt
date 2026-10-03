package se.otid.station.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.nio.charset.StandardCharsets

class StrictUtf8Test {
    @Test
    fun `valid UTF-8 is decoded byte exactly`() {
        val value = "Tävlingspaket \uD83C\uDFC1"

        assertEquals(
            value,
            StrictUtf8.decode(
                value.toByteArray(StandardCharsets.UTF_8),
                StationStoreErrors.INVALID_PACKAGE,
                "invalid",
            ),
        )
    }

    @Test
    fun `malformed UTF-8 fails with the requested stable code`() {
        val failure = assertThrows(StationStoreFailure::class.java) {
            StrictUtf8.decode(
                byteArrayOf(0xc3.toByte(), 0x28),
                StationStoreErrors.INVALID_PACKAGE,
                "invalid",
            )
        }

        assertEquals(StationStoreErrors.INVALID_PACKAGE, failure.code)
        assertEquals("invalid", failure.message)
    }
}

package se.otid.participant.gps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GpsJournalEncodingTest {
    @Test
    fun hashIsStableForTheSameOrderedPointJournal() {
        val points = listOf(point(1, 1, 1_000L), point(2, 1, 900L))

        val first = GpsJournalEncoding.sha256(RECORDING_ID, points)
        val second = GpsJournalEncoding.sha256(RECORDING_ID, points)

        assertEquals(first, second)
        assertTrue(first.matches(Regex("^[a-f0-9]{64}$")))
    }

    @Test
    fun hashBindsSequenceSegmentMeasurementAndAvailableAccuracy() {
        val original = listOf(point(1, 1, 1_000L), point(2, 2, 900L))

        assertNotEquals(
            GpsJournalEncoding.sha256(RECORDING_ID, original),
            GpsJournalEncoding.sha256(RECORDING_ID, original.reversed()),
        )
        assertNotEquals(
            GpsJournalEncoding.sha256(RECORDING_ID, original),
            GpsJournalEncoding.sha256(RECORDING_ID, original.map { it.copy(accuracyM = 7f) }),
        )
        assertNotEquals(
            GpsJournalEncoding.sha256(RECORDING_ID, original),
            GpsJournalEncoding.sha256("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", original),
        )
    }

    @Test
    fun signedZeroHasOneCanonicalEncoding() {
        val positive = point(1, 1, 1L).copy(latitude = 0.0, longitude = 0.0, accuracyM = 0f)
        val negative = positive.copy(latitude = -0.0, longitude = -0.0, accuracyM = -0.0f)

        assertEquals(
            GpsJournalEncoding.sha256(RECORDING_ID, listOf(positive)),
            GpsJournalEncoding.sha256(RECORDING_ID, listOf(negative)),
        )
    }

    private fun point(sequence: Long, segment: Int, measuredAtMs: Long) = GpsJournalPoint(
        sequence = sequence,
        segmentNumber = segment,
        measuredAtMs = measuredAtMs,
        latitude = 59.3293,
        longitude = 18.0686,
        accuracyM = 4.5f,
        elapsedRealtimeNanos = sequence * 1_000_000L,
    )

    companion object {
        private const val RECORDING_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    }
}

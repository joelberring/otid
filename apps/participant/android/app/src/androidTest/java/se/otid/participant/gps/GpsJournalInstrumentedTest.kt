package se.otid.participant.gps

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import java.io.FileOutputStream
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class GpsJournalInstrumentedTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val databaseNames = mutableListOf<String>()

    @After
    fun removeTestDatabases() {
        databaseNames.forEach(context::deleteDatabase)
    }

    @Test
    fun sequencePersistsAcrossInterruptionAndExplicitResumeThenStopFreezesHash() {
        val name = databaseName()
        val first = GpsJournal(context, name)
        val started = first.start(10_000L)
        val id = started.id
        val pointOne = first.append(id, 10_500L, 59.3, 18.0, 4.0f, 55_000_000L)
        assertEquals(1, pointOne.pointCount)

        val interrupted = first.interruptOpen(11_000L)
        assertNotNull(interrupted)
        assertEquals(GpsRecordingState.INTERRUPTED, interrupted!!.state)
        first.close()

        val reopened = GpsJournal(context, name)
        assertEquals(interrupted, reopened.latest())
        assertEquals(GpsJournal.INVALID_STATE, assertThrows(GpsJournalFailure::class.java) {
            reopened.append(id, 11_500L, 59.4, 18.1, null, 60_000_000L)
        }.code)

        val resumed = reopened.resume(id, 12_000L)
        assertEquals(GpsRecordingState.RECORDING, resumed.state)
        val pointTwo = reopened.append(id, 9_000L, 59.5, 18.2, null, 70_000_000L)
        assertEquals(2, pointTwo.pointCount)
        // Callback order is retained even when a provider measurement timestamp moves backward.
        assertEquals(9_000L, pointTwo.lastMeasuredAtMs)

        val stopped = reopened.stop(id, 13_000L)
        assertEquals(GpsRecordingState.STOPPED, stopped.state)
        assertEquals(2, stopped.pointCount)
        assertNotNull(stopped.hash)
        assertEquals(stopped, reopened.stop(id, 14_000L))
        assertEquals(GpsJournal.INVALID_STATE, assertThrows(GpsJournalFailure::class.java) {
            reopened.append(id, 14_500L, 59.6, 18.3, 3f, 80_000_000L)
        }.code)
        reopened.close()

        val afterProcessReopen = GpsJournal(context, name)
        assertEquals(stopped, afterProcessReopen.latest())
        assertEquals(stopped.hash, afterProcessReopen.latest()?.hash)
        afterProcessReopen.close()
    }

    @Test
    fun pointLimitDoesNotConsumeSequenceAndInterruptedRecordingCanBeFrozen() {
        val journal = GpsJournal(context, databaseName(), maxPointsPerRecording = 1)
        val started = journal.start(1L)
        journal.append(started.id, 2L, 0.0, 0.0, null, 3L)

        assertEquals(GpsJournal.POINT_LIMIT, assertThrows(GpsJournalFailure::class.java) {
            journal.append(started.id, 4L, 1.0, 1.0, null, 5L)
        }.code)
        assertEquals(1, journal.latest()?.pointCount)

        journal.interruptOpen(6L)
        val frozen = journal.stop(started.id, 7L)
        assertEquals(GpsRecordingState.STOPPED, frozen.state)
        assertNotNull(frozen.hash)
        journal.close()
    }

    @Test
    fun sameMillisecondStartsUseDurableOrderAndInterruptedRecordingMustBeStoppedFirst() {
        val journal = GpsJournal(context, databaseName())
        val first = journal.start(1_000L)
        journal.interruptOpen(1_001L)

        assertEquals(GpsJournal.INVALID_STATE, assertThrows(GpsJournalFailure::class.java) {
            journal.start(1_000L)
        }.code)
        journal.stop(first.id, 1_002L)

        val second = journal.start(1_000L)
        assertEquals(second.id, journal.latest()?.id)
        journal.close()
    }

    @Test
    fun noOpenRecordingReturnsNullAndCorruptDatabaseFailsClosed() {
        val name = databaseName()
        val journal = GpsJournal(context, name)
        assertNull(journal.interruptOpen(1L))
        journal.start(2L)
        journal.close()

        FileOutputStream(context.getDatabasePath(name), false).use { it.write(byteArrayOf(0, 1, 2, 3, 4)) }
        val corrupted = GpsJournal(context, name)
        val failure = assertThrows(GpsJournalFailure::class.java) { corrupted.latest() }
        assertEquals(GpsJournal.STORAGE_FAILURE, failure.code)
        corrupted.close()
    }

    @Test
    fun invalidCoordinatesNeverCreateASequence() {
        val journal = GpsJournal(context, databaseName())
        val started = journal.start(1L)
        assertThrows(IllegalArgumentException::class.java) {
            journal.append(started.id, 2L, Double.NaN, 0.0, null, 3L)
        }
        assertEquals(0, journal.latest()?.pointCount)
        assertEquals(GpsRecordingState.RECORDING, journal.latest()?.state)
        journal.close()
    }

    private fun databaseName(): String = "gps-journal-${UUID.randomUUID()}.db".also(databaseNames::add)
}

package se.otid.station;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertEquals;

import android.content.res.XmlResourceParser;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.xmlpull.v1.XmlPullParser;

@RunWith(AndroidJUnit4.class)
public class PluginRegistrationTest {
    @Test
    public void rawUsbPluginIsRegisteredByTheActivity() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                assertNotNull(activity.getBridge().getPlugin("OtidUsbSerial"));
                assertNotNull(activity.getBridge().getPlugin("OtidStationStore"));
            });
        }
    }

    @Test
    public void stationDatabaseIsExcludedFromBackupAndDeviceTransfer() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                assertEquals(1, countDatabaseExclusions(activity.getResources().getXml(R.xml.backup_rules)));
                assertEquals(2, countDatabaseExclusions(activity.getResources().getXml(R.xml.data_extraction_rules)));
            });
        }
    }

    private static int countDatabaseExclusions(XmlResourceParser parser) {
        int count = 0;
        try (parser) {
            int event = parser.getEventType();
            while (event != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG
                    && "exclude".equals(parser.getName())
                    && "database".equals(parser.getAttributeValue(null, "domain"))
                    && ".".equals(parser.getAttributeValue(null, "path"))) {
                    count += 1;
                }
                event = parser.next();
            }
            return count;
        } catch (Exception failure) {
            throw new AssertionError("Backupregeln kunde inte läsas", failure);
        }
    }
}

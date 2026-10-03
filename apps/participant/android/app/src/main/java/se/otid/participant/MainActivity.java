package se.otid.participant;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import se.otid.participant.GpsRecorderPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GpsRecorderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

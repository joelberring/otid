package se.berring.otid;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import se.berring.otid.tracking.OTidTrackingPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Lokala pluginer registreras före super.onCreate (Capacitors anvisning för egen kod).
        registerPlugin(OTidTrackingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

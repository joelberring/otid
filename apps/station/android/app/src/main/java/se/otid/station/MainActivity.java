package se.otid.station;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import se.otid.station.store.OtidStationStorePlugin;
import se.otid.station.usb.OtidUsbSerialPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OtidUsbSerialPlugin.class);
        registerPlugin(OtidStationStorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

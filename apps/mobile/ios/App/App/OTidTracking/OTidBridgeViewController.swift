import Capacitor

/// Webbvyn med den egna modulen OTidTracking registrerad (Capacitors väg för lokala pluginer).
class OTidBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(OTidTrackingPlugin())
    }
}

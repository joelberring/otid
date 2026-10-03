import { registerPlugin } from "@capacitor/core";
import type { AndroidUsbCapacitorPlugin } from "@o-tid/device-transport";

export const OtidUsbSerial = registerPlugin<AndroidUsbCapacitorPlugin>("OtidUsbSerial");

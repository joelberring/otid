import { describe, expect, it } from "vitest";
import type { AndroidUsbWireEvent, AndroidUsbWireWriteRequest } from "../src";

describe("Android USB Capacitor wire-kontrakt", () => {
  it("representerar bytes och nanosekundstid utan Uint8Array eller bigint", () => {
    const request: AndroidUsbWireWriteRequest = {
      connectionId: "connection-1",
      bytesBase64: "AQID",
      writeTimeoutMs: 2_000
    };
    const event: AndroidUsbWireEvent = {
      type: "bytes",
      connectionId: "connection-1",
      bytesBase64: "BAUG",
      nativeSequence: "42",
      elapsedRealtimeNanos: "9223372036854775807"
    };
    expect(JSON.parse(JSON.stringify({ request, event }))).toEqual({ request, event });
  });

  it("har separata attach-, detach- och state-events med gemensam nativeordning", () => {
    const events: readonly AndroidUsbWireEvent[] = [
      {
        type: "attach",
        connectionId: null,
        nativeSequence: "1",
        elapsedRealtimeNanos: "100",
        device: { deviceId: "usb-1", vendorId: 4292, productId: 60000, portIndexes: [0] }
      },
      {
        type: "state",
        connectionId: "connection-1",
        nativeSequence: "2",
        elapsedRealtimeNanos: "200",
        status: "open",
        code: null,
        message: null
      },
      {
        type: "detach",
        connectionId: "connection-1",
        nativeSequence: "3",
        elapsedRealtimeNanos: "300",
        deviceId: "usb-1"
      }
    ];
    expect(events.map((event) => event.type)).toEqual(["attach", "state", "detach"]);
    expect(events.map((event) => event.nativeSequence)).toEqual(["1", "2", "3"]);
  });
});

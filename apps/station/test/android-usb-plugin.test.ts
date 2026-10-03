import { describe, expect, it } from "vitest";

describe("O-Tid Station Android plugin boundary", () => {
  it("uses the native plugin name fixed by ADR-0009", async () => {
    const module = await import("../src/android-usb-plugin");

    expect(module.OtidUsbSerial).toBeDefined();
  });
});

import { describe, expect, it } from "vitest";
import { chooseStation, forgetStation, loadRememberedStation, rememberStation } from "./station-memory";

/** Steg 35: vilken godkänd station som ansluts automatiskt och hur valet sparas. */
function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
const throwing = { getItem: () => { throw new Error("blockerad"); }, setItem: () => { throw new Error("blockerad"); },
  removeItem: () => { throw new Error("blockerad"); } };

type Device = { name: string; vendorId: number; productId: number; serialNumber?: string };
const identify = (device: Device) => device;
const bsm = (name: string, serialNumber?: string): Device => ({ name, vendorId: 0x10c4, productId: 0x800a, ...(serialNumber ? { serialNumber } : {}) });

describe("chooseStation", () => {
  it("väljer den senast använda stationen, annars den enda, och ber annars användaren välja", () => {
    const a = bsm("a", "1001"), b = bsm("b", "1002");
    expect(chooseStation([], { link: "usb" }, identify)).toEqual({ kind: "none" });
    expect(chooseStation([a], undefined, identify)).toEqual({ kind: "one", device: a });
    expect(chooseStation([a, b], undefined, identify)).toEqual({ kind: "ask", devices: [a, b] });
    expect(chooseStation([a, b], { link: "usb", vendorId: 0x10c4, productId: 0x800a, serialNumber: "1002" }, identify))
      .toEqual({ kind: "one", device: b });
    // Den sparade stationen sitter inte i: en annan enda station ansluts, bland flera får användaren välja.
    expect(chooseStation([a], { link: "usb", vendorId: 0x10c4, productId: 0x800a, serialNumber: "9999" }, identify))
      .toEqual({ kind: "one", device: a });
    expect(chooseStation([a, b], { link: "usb", vendorId: 0x10c4, productId: 0x800a, serialNumber: "9999" }, identify).kind).toBe("ask");
  });

  it("utan serienummer (Web Serial) räcker samma tillverkare och produkt om bara en enhet har dem", () => {
    const station = bsm("station"), other: Device = { name: "annan", vendorId: 0x0403, productId: 0x6001 };
    expect(chooseStation([other, station], { link: "serial", vendorId: 0x10c4, productId: 0x800a }, identify))
      .toEqual({ kind: "one", device: station });
    expect(chooseStation([station, bsm("två")], { link: "serial", vendorId: 0x10c4, productId: 0x800a }, identify).kind).toBe("ask");
  });
});

describe("den sparade stationen", () => {
  it("sparas, läses och glöms per webbläsare; trasigt eller blockerat värde ger inget", () => {
    const storage = memoryStorage();
    expect(loadRememberedStation(storage)).toBeUndefined();
    rememberStation("usb", { vendorId: 0x10c4, productId: 0x800a, serialNumber: "1001" }, storage);
    expect(loadRememberedStation(storage)).toEqual({ link: "usb", vendorId: 0x10c4, productId: 0x800a, serialNumber: "1001" });
    rememberStation("serial", { vendorId: undefined, productId: undefined }, storage);
    expect(loadRememberedStation(storage)).toEqual({ link: "serial" });
    forgetStation(storage);
    expect(loadRememberedStation(storage)).toBeUndefined();
    storage.setItem("otid.readout.station.v1", "{inte json");
    expect(loadRememberedStation(storage)).toBeUndefined();
    storage.setItem("otid.readout.station.v1", JSON.stringify({ link: "bluetooth" }));
    expect(loadRememberedStation(storage)).toBeUndefined();
    expect(loadRememberedStation(throwing)).toBeUndefined();
    expect(() => rememberStation("usb", {}, throwing)).not.toThrow();
    expect(() => forgetStation(throwing)).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import {
  CP210X, WebSerialTransport, WebUsbCp210xPort, type UsbConfigurationLike, type UsbControlSetup, type UsbDeviceLike,
  type UsbInResult, type UsbLike, type UsbOutResult
} from "../src";

/** En påhittad CP210x (SPORTident BSM8-USB) med köad indata och loggade styrkommandon. */
class FakeCp210x implements UsbDeviceLike {
  readonly vendorId = 0x10c4;
  readonly productId = 0x800a;
  opened = false;
  configuration: UsbConfigurationLike | null = null;
  readonly controls: { request: number; value: number; index: number; data?: number[] }[] = [];
  readonly written: number[][] = [];
  readonly claimed: number[] = [];
  #incoming: Uint8Array[] = [];
  #waiting: ((result: UsbInResult) => void) | undefined;
  #reject: ((error: Error) => void) | undefined;

  async open() { this.opened = true; }
  async close() {
    this.opened = false;
    this.#reject?.(new Error("The transfer was cancelled."));
    this.#waiting = undefined; this.#reject = undefined;
  }
  async selectConfiguration() {
    this.configuration = { configurationValue: 1, interfaces: [{ interfaceNumber: 0, alternate: { endpoints: [
      { endpointNumber: 1, direction: "in", type: "bulk" }, { endpointNumber: 1, direction: "out", type: "bulk" }] } }] };
  }
  async claimInterface(interfaceNumber: number) { this.claimed.push(interfaceNumber); }
  async releaseInterface(interfaceNumber: number) { this.claimed.splice(this.claimed.indexOf(interfaceNumber), 1); }
  async controlTransferOut(setup: UsbControlSetup, data?: BufferSource): Promise<UsbOutResult> {
    expect(setup).toMatchObject({ requestType: "vendor", recipient: "interface" });
    this.controls.push({ request: setup.request, value: setup.value, index: setup.index,
      ...(data ? { data: [...new Uint8Array(data as ArrayBuffer)] } : {}) });
    return { status: "ok" };
  }
  transferIn(endpointNumber: number): Promise<UsbInResult> {
    expect(endpointNumber).toBe(1);
    const next = this.#incoming.shift();
    if (next) return Promise.resolve({ status: "ok", data: new DataView(next.buffer) });
    return new Promise((resolve, reject) => { this.#waiting = resolve; this.#reject = reject; });
  }
  async transferOut(endpointNumber: number, data: BufferSource): Promise<UsbOutResult> {
    expect(endpointNumber).toBe(1);
    this.written.push([...new Uint8Array(data as ArrayBuffer)]);
    return { status: "ok", bytesWritten: (data as ArrayBuffer).byteLength };
  }
  /** Stationen skickar byte. */
  push(bytes: number[]) {
    const chunk = Uint8Array.from(bytes);
    if (this.#waiting) { const resolve = this.#waiting; this.#waiting = undefined; this.#reject = undefined; resolve({ status: "ok", data: new DataView(chunk.buffer) }); }
    else this.#incoming.push(chunk);
  }
}

class FakeUsb implements UsbLike {
  readonly listeners = new Set<(event: { readonly device: unknown }) => void>();
  addEventListener(_type: "disconnect", listener: (event: { readonly device: unknown }) => void) { this.listeners.add(listener); }
  removeEventListener(_type: "disconnect", listener: (event: { readonly device: unknown }) => void) { this.listeners.delete(listener); }
  unplug(device: unknown) { for (const listener of [...this.listeners]) listener({ device }); }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SPORTident-station över WebUSB (CP210x, läsplatta)", () => {
  it("ställer in chipet som SPORTident vill ha det: på, 38400 baud, 8N1, DTR/RTS, tömda buffertar", async () => {
    const device = new FakeCp210x();
    const port = new WebUsbCp210xPort(device);
    await port.open({ baudRate: 38_400 });
    expect(device.claimed).toEqual([0]);
    expect(device.controls).toEqual([
      { request: CP210X.IFC_ENABLE, value: CP210X.UART_ENABLE, index: 0 },
      { request: CP210X.SET_BAUDRATE, value: 0, index: 0, data: [0x00, 0x96, 0x00, 0x00] },
      { request: CP210X.SET_LINE_CTL, value: 0x0800, index: 0 },
      { request: CP210X.SET_MHS, value: 0x0303, index: 0 },
      { request: CP210X.PURGE, value: 0x000f, index: 0 }
    ]);
    await port.close();
    expect(device.opened).toBe(false);
    expect(device.claimed).toEqual([]);
    expect(device.controls.at(-1)).toEqual({ request: CP210X.IFC_ENABLE, value: CP210X.UART_DISABLE, index: 0 });
  });

  it("fungerar med samma transport som Web Serial: läser, skriver, stänger och öppnar igen med annan hastighet", async () => {
    const device = new FakeCp210x();
    const port = new WebUsbCp210xPort(device);
    const transport = new WebSerialTransport(port, { baudRate: 38_400 });
    const received: number[] = [];
    transport.onBytes((chunk) => received.push(...chunk));
    await transport.open();
    device.push([0x02, 0xf0]);
    device.push([0x03]);
    await tick(); await tick();
    expect(received).toEqual([0x02, 0xf0, 0x03]);
    await transport.write(Uint8Array.from([0xff, 0x02, 0x83]));
    expect(device.written).toEqual([[0xff, 0x02, 0x83]]);
    await transport.close();
    expect(device.opened).toBe(false);

    // Appen provar 4800 baud om 38400 inte svarar: samma port öppnas igen.
    const slow = new WebSerialTransport(port, { baudRate: 4_800 });
    await slow.open();
    expect(device.controls.filter((control) => control.request === CP210X.SET_BAUDRATE).at(-1)?.data).toEqual([0xc0, 0x12, 0x00, 0x00]);
    await slow.close();
  });

  it("säger till när stationen dras ur", async () => {
    const device = new FakeCp210x(), usb = new FakeUsb();
    const port = new WebUsbCp210xPort(device, usb);
    const transport = new WebSerialTransport(port, { baudRate: 38_400 });
    const states: string[] = [];
    transport.onState((state) => states.push(state.status));
    await transport.open();
    usb.unplug(new FakeCp210x());
    expect(states).not.toContain("detached");
    usb.unplug(device);
    await tick(); await tick();
    expect(states).toContain("detached");
    expect(states.at(-1)).toBe("closed");
  });

  it("avvisar en USB-enhet utan dataändpunkter", async () => {
    const device = new FakeCp210x();
    device.selectConfiguration = async () => { device.configuration = { configurationValue: 1, interfaces: [
      { interfaceNumber: 0, alternate: { endpoints: [] } }] }; };
    await expect(new WebUsbCp210xPort(device).open({ baudRate: 38_400 })).rejects.toThrow(/dataändpunkter/);
  });
});

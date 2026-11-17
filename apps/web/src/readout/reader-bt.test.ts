import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  READER_BT_ACK_CARD, READER_BT_CARD_DATA, READER_BT_COMMAND, READER_BT_EVENTS, READER_BT_SERVICE_CARDS, READER_BT_SERVICE_MAIN,
  READER_BT_START_READOUT
} from "@o-tid/sportident";
import { ReaderBtController, type BluetoothCharacteristicLike, type BluetoothDeviceLike } from "./reader-bt";
import type { StationCallbacks, StationStatus } from "./station";

const hex = (value: string) => Uint8Array.from(value.match(/../g)!, (pair) => parseInt(pair, 16));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Riktiga notifieringar från Reader BT 1000298 (som i packages/sportident/test/reader-bt.test.ts; ägaruppgifterna utbytta). */
const SI9_1200002 = "03114000824f120001040000010100c0b4171900020100c0b41719000518009040cc2100073200c086bf2101313230303030323b53504f52546964656e74205377656465";
const SI11_9150186 = [
  "01a1f400013101000003112d01ea9e8b000f130000020600e8c950020001020080224c0200050a0048b1900200060a0048b190020007290028c5560200072b00487e5a020007310030b766020007320070b86b0200073300d8e26f020007520040607b0200075700405a7c0200073b007034810200073900300f820200073d00b035860200073e00e027870200074f00a002880200075400d83a8b0200075b0000528d0200076400183c90020c195701100000000c0b1b0c0b01393135303138363b546573746b6c7562623b3b3b3b0000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "01a1430002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
];

class FakeCharacteristic extends EventTarget implements BluetoothCharacteristicLike {
  value: DataView | null = null;
  readonly written: string[] = [];
  notifying = false;
  constructor(readonly uuid: string) { super(); }
  async startNotifications() { this.notifying = true; }
  async writeValueWithResponse(data: Uint8Array<ArrayBuffer>) { this.written.push(toHex(data)); }
  notify(bytes: Uint8Array) {
    this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}

class FakeDevice extends EventTarget implements BluetoothDeviceLike {
  readonly name = "Reader BT 1000298";
  readonly characteristics = new Map([READER_BT_EVENTS, READER_BT_CARD_DATA, READER_BT_COMMAND].map((uuid) => [uuid, new FakeCharacteristic(uuid)]));
  connects = 0;
  failConnects = 0;
  connected = false;
  readonly gatt = {
    get connected() { return false; },
    connect: async () => {
      this.connects += 1;
      if (this.failConnects > 0) { this.failConnects -= 1; throw new Error("ingen kontakt"); }
      this.connected = true;
      return this.gatt;
    },
    disconnect: () => { this.connected = false; },
    getPrimaryService: async (uuid: string) => {
      if (uuid !== READER_BT_SERVICE_CARDS && uuid !== READER_BT_SERVICE_MAIN) throw new Error(`okänd tjänst ${uuid}`);
      return { getCharacteristic: async (char: string) => this.characteristics.get(char)! };
    }
  };
  char(uuid: string) { return this.characteristics.get(uuid)!; }
  drop() { this.connected = false; this.dispatchEvent(new Event("gattserverdisconnected")); }
}

function callbacks() {
  const statuses: StationStatus[] = [];
  const spies = {
    onStatus: vi.fn((status: StationStatus) => { statuses.push(status); }),
    onCardInserted: vi.fn(), onCardRead: vi.fn(), onReadFailed: vi.fn(), onUnsupportedCard: vi.fn(), onLog: vi.fn()
  } satisfies StationCallbacks;
  return { spies, statuses };
}

describe("ReaderBtController", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("startar avläsningsläget, sätter ihop brickan, kvitterar och lämnar den vidare", async () => {
    const device = new FakeDevice();
    const { spies, statuses } = callbacks();
    const controller = new ReaderBtController(device, spies, { lostMessage: "borta" });
    await expect(controller.start()).resolves.toBe(true);
    expect(device.char(READER_BT_COMMAND).written).toEqual([toHex(READER_BT_START_READOUT)]);
    expect(device.char(READER_BT_EVENTS).notifying && device.char(READER_BT_CARD_DATA).notifying).toBe(true);
    expect(statuses.at(-1)).toEqual({ kind: "ready", serialNumber: 1_000_298, link: "bluetooth" });

    device.char(READER_BT_EVENTS).notify(hex("01110700ea9e8b00010500"));
    expect(spies.onCardInserted).toHaveBeenCalledWith(9_150_186);
    device.char(READER_BT_CARD_DATA).notify(hex(SI11_9150186[0]!));
    expect(spies.onCardRead).not.toHaveBeenCalled();
    device.char(READER_BT_CARD_DATA).notify(hex(SI11_9150186[1]!));
    await vi.runAllTimersAsync();
    expect(device.char(READER_BT_CARD_DATA).written).toEqual([toHex(READER_BT_ACK_CARD)]);
    const [card, frames, facts] = spies.onCardRead.mock.calls[0] as Parameters<StationCallbacks["onCardRead"]>;
    expect(card).toMatchObject({ cardType: "SI11", cardNumber: 9_150_186 });
    expect(frames.map(toHex)).toEqual(SI11_9150186);
    expect(facts).toEqual({ serialNumber: 1_000_298, clock: undefined });
  });

  it("utan i-händelse anmäls brickan när innehållet kommer", async () => {
    const device = new FakeDevice();
    const { spies } = callbacks();
    await new ReaderBtController(device, spies, { lostMessage: "borta" }).start();
    device.char(READER_BT_CARD_DATA).notify(hex(SI9_1200002));
    expect(spies.onCardInserted).toHaveBeenCalledWith(1_200_002);
    expect(spies.onCardRead).toHaveBeenCalledOnce();
  });

  it("ansluter igen när förbindelsen bryts, och ger upp med ett besked", async () => {
    const device = new FakeDevice();
    const { spies, statuses } = callbacks();
    await new ReaderBtController(device, spies, { lostMessage: "borta", reconnectDelaysMs: [10, 10] }).start();
    device.failConnects = 1;
    device.drop();
    expect(statuses.at(-1)).toEqual({ kind: "connecting" });
    await vi.runAllTimersAsync();
    expect(device.connects).toBe(3);
    expect(statuses.at(-1)).toMatchObject({ kind: "ready" });
    expect(device.char(READER_BT_COMMAND).written).toHaveLength(2);
    // Gamla lyssnare är borta: en bricka ger en avläsning, inte två.
    device.char(READER_BT_CARD_DATA).notify(hex(SI9_1200002));
    expect(spies.onCardRead).toHaveBeenCalledOnce();

    device.failConnects = 5;
    device.drop();
    await vi.runAllTimersAsync();
    expect(statuses.at(-1)).toEqual({ kind: "error", message: "borta" });
  });

  it("frånkoppling ansluter inte igen", async () => {
    const device = new FakeDevice();
    const { spies, statuses } = callbacks();
    const controller = new ReaderBtController(device, spies, { lostMessage: "borta", reconnectDelaysMs: [10] });
    await controller.start();
    await controller.stop();
    device.drop();
    await vi.runAllTimersAsync();
    expect(device.connects).toBe(1);
    expect(statuses.at(-1)).toEqual({ kind: "disconnected" });
  });

  it("bricka som inte stöds och trasigt innehåll", async () => {
    const device = new FakeDevice();
    const { spies } = callbacks();
    await new ReaderBtController(device, spies, { lostMessage: "borta" }).start();
    const si6 = hex(SI9_1200002); si6.set([0x20, 0xa1, 0x07, 0x00], 4);
    device.char(READER_BT_CARD_DATA).notify(si6);
    expect(spies.onUnsupportedCard).toHaveBeenCalledWith(500_000);
    const flagged = hex(SI9_1200002); flagged[11] = 0x01;
    device.char(READER_BT_CARD_DATA).notify(flagged);
    expect(spies.onReadFailed).toHaveBeenCalledWith(1_200_002, expect.stringMatching(/okänd flagga/));
    await vi.runAllTimersAsync();
    expect(device.char(READER_BT_CARD_DATA).written).toHaveLength(2);
    expect(spies.onCardRead).not.toHaveBeenCalled();
  });

  it("misslyckad anslutning ger falskt", async () => {
    const device = new FakeDevice();
    device.failConnects = 1;
    const { spies } = callbacks();
    await expect(new ReaderBtController(device, spies, { lostMessage: "borta" }).start()).resolves.toBe(false);
  });
});

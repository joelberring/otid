import { describe, expect, it } from "vitest";
import { BluetoothPrinter, PRINTER_SERVICE, PRINTER_WRITE } from "./bluetooth-printer";
import { encodeCp1252, receiptToEscPos, wrap } from "./escpos";
import type { BluetoothCharacteristicLike, BluetoothDeviceLike } from "./reader-bt";
import type { Receipt } from "./receipt";

const receipt: Receipt = {
  eventName: "Klubbmästerskap i orientering på Djurgården 2026", details: "Medel · 18 nov 2026",
  runner: "Åsa Ødegård-Müller", team: "D21 · OK Ärlan", card: "Bricka 1200002",
  symbol: "✓", status: "Godkänd", result: "45:12", notes: ["Hyrbricka – lämna tillbaka"], lines: [],
  columns: ["", "Kontroll", "Sträcka", "Tid"],
  rows: [{ index: "1", code: "31", leg: "3:05", total: "3:05" }, { index: "M", code: "Mål", leg: "0:32", total: "45:12" }],
  qr: { url: "https://otid.se/t/abc234", address: "otid.se/t/abc234", published: true }, printedAt: "18 nov 19:40"
};
const text = { noSplits: "Inga sträcktider.", scan: "Skanna för dina resultat", footer: "O-Tid" };

/** Textraderna i utskriften (styrkoder och QR-kommandot borttagna), avkodade som Windows-1252. */
function printedLines(bytes: Uint8Array): string[] {
  const decoder = new TextDecoder("windows-1252");
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x1b || b === 0x1c) { i += b === 0x1c ? 1 : bytes[i + 1] === 0x40 ? 1 : bytes[i + 1] === 0x74 || bytes[i + 1] === 0x64 || bytes[i + 1] === 0x61 || bytes[i + 1] === 0x45 ? 2 : 1; continue; }
    if (b === 0x1d && bytes[i + 1] === 0x21) { i += 2; continue; }
    if (b === 0x1d && bytes[i + 1] === 0x28) { i += 4 + bytes[i + 3]! + (bytes[i + 4]! << 8); continue; }
    out.push(b);
  }
  return decoder.decode(Uint8Array.from(out)).split("\n");
}

describe("receiptToEscPos", () => {
  it("skriver kvittot med högst 32 tecken per rad på 58 mm och åäöøü rätt", () => {
    const lines = printedLines(receiptToEscPos(receipt, { paperMm: 58, text }));
    expect(lines.every((line) => line.length <= 32)).toBe(true);
    expect(lines).toContain("Åsa Ødegård-Müller");
    expect(lines).toContain(`Godkänd${" ".repeat(32 - "Godkänd".length - 5)}45:12`);
    expect(lines).toContain("    Kontroll   Sträcka       Tid");
    expect(lines).toContain("M        Mål      0:32     45:12");
    expect(lines).toContain("Hyrbricka – lämna tillbaka");
    expect(lines).toContain("18 nov 19:40 · O-Tid");
  });

  it("väljer Windows-1252, slår av kinesiskt läge och låter skrivaren rita QR-koden", () => {
    const bytes = Array.from(receiptToEscPos(receipt, { paperMm: 58, text }));
    expect(bytes.slice(0, 7)).toEqual([0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, 16]);
    const url = Array.from(new TextEncoder().encode(receipt.qr.url));
    const store = [0x1d, 0x28, 0x6b, url.length + 3, 0, 0x31, 0x50, 0x30, ...url];
    expect(bytes.join(",")).toContain(store.join(","));
  });

  it("ger 48 tecken per rad på 80 mm och en rad när sträcktiderna saknas", () => {
    const lines = printedLines(receiptToEscPos({ ...receipt, rows: [] }, { paperMm: 80, text }));
    expect(lines.every((line) => line.length <= 48)).toBe(true);
    expect(lines).toContain("Inga sträcktider.");
    expect(lines.some((line) => line.length > 32)).toBe(true);
  });

  it("kodar och radbryter", () => {
    expect(encodeCp1252("åäö ÅÄÖ é € – ✓")).toEqual([0xe5, 0xe4, 0xf6, 0x20, 0xc5, 0xc4, 0xd6, 0x20, 0xe9, 0x20, 0x80, 0x20, 0x96, 0x20, 0x3f]);
    expect(wrap("Klubbmästerskap i orientering", 12)).toEqual(["Klubbmästers", "kap i", "orientering"]);
    expect(wrap("", 10)).toEqual([""]);
  });
});

class FakeWrite extends EventTarget implements BluetoothCharacteristicLike {
  readonly chunks: number[] = [];
  fail = false;
  async startNotifications() {}
  async writeValueWithResponse(data: Uint8Array<ArrayBuffer>) { if (this.fail) throw new Error("GATT"); this.chunks.push(data.length); }
}

function fakePrinter() {
  const write = new FakeWrite();
  let connected = false;
  let connects = 0;
  const device: BluetoothDeviceLike & EventTarget = Object.assign(new EventTarget(), {
    name: "SI Printer 2 02063",
    gatt: {
      get connected() { return connected; },
      async connect() { connects += 1; connected = true; return device.gatt!; },
      disconnect() { connected = false; },
      async getPrimaryService(uuid: string) {
        expect(uuid).toBe(PRINTER_SERVICE);
        return { getCharacteristic: async (char: string) => { expect(char).toBe(PRINTER_WRITE); return write; } };
      }
    }
  });
  return { device, write, connects: () => connects, drop: () => { connected = false; } };
}

describe("BluetoothPrinter", () => {
  it("skickar i bitar om 100 byte och ansluter igen när förbindelsen har brutits", async () => {
    const fake = fakePrinter();
    const printer = new BluetoothPrinter(fake.device);
    await printer.connect();
    await printer.print(new Uint8Array(250));
    expect(fake.write.chunks).toEqual([100, 100, 50]);
    fake.drop();
    await printer.print(new Uint8Array(10));
    expect(fake.connects()).toBe(2);
    expect(printer.name).toBe("SI Printer 2 02063");
  });

  it("ett fel stoppar inte nästa utskrift", async () => {
    const fake = fakePrinter();
    const printer = new BluetoothPrinter(fake.device);
    fake.write.fail = true;
    await expect(printer.print(new Uint8Array(10))).rejects.toThrow("GATT");
    fake.write.fail = false;
    await printer.print(new Uint8Array(10));
    expect(fake.write.chunks).toEqual([10]);
  });
});

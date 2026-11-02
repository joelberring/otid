import { describe, expect, it } from "vitest";
import { ZipError, ZipReader, writeZip } from "../src/race-backup-zip";

/** ADR-0187: säkerhetskopians zip. Det som skrivs går att läsa, och läsaren håller gränserna (namn, storlek, CRC). */
const limits = { maxEntries: 10, maxEntryBytes: () => 1_000_000, maxTotalBytes: 2_000_000, name: /^(manifest\.json|filer\/[a-z]+|[a-z]+)$/ };
const text = (value: string) => new TextEncoder().encode(value);

describe("säkerhetskopians zip", () => {
  it("skriver och läser tillbaka, komprimerat eller orört", () => {
    const random = new Uint8Array(5000).map(() => Math.floor(Math.random() * 256));
    const zip = writeZip([{ name: "manifest.json", data: text("{\"a\":1}".repeat(500)) }, { name: "filer/bild", data: random }]);
    const reader = new ZipReader(zip, limits);
    expect([...reader.entries.keys()]).toEqual(["manifest.json", "filer/bild"]);
    expect(new TextDecoder().decode(reader.extract("manifest.json"))).toBe("{\"a\":1}".repeat(500));
    expect(Buffer.from(reader.extract("filer/bild")!).equals(Buffer.from(random))).toBe(true);
    expect(reader.extract("saknas")).toBeUndefined();
  });

  it("avvisar okända namn, för stora poster (också när storleken i katalogen ljuger), dubbletter och ändrade bytes", () => {
    expect(() => new ZipReader(writeZip([{ name: "../ut", data: text("x") }]), limits)).toThrow(ZipError);
    expect(() => new ZipReader(writeZip([{ name: "stor", data: new Uint8Array(1_000_001) }]), limits)).toThrow(/För stor/);
    expect(() => new ZipReader(writeZip([{ name: "a", data: text("x") }, { name: "a", data: text("y") }]), limits)).toThrow(/två gånger/);
    expect(() => new ZipReader(text("inte en zip"), limits)).toThrow(/inte ett zip/);
    // En "zip-bomb": katalogen säger 10 bytes men posten packas upp till en miljon.
    const bomb = Buffer.from(writeZip([{ name: "bomb", data: new Uint8Array(1_000_000) }]));
    const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(10, central + 24);
    expect(() => new ZipReader(bomb, limits).extract("bomb")).toThrow(/trasig/);
    // En ändrad byte i en okomprimerad post fångas av CRC.
    const random = new Uint8Array(100).map(() => Math.floor(Math.random() * 256));
    const zip = Buffer.from(writeZip([{ name: "fil", data: random }]));
    zip[30 + 3 + 10] = zip[30 + 3 + 10]! ^ 0xff;
    expect(() => new ZipReader(zip, limits).extract("fil")).toThrow(/trasig/);
  });
});

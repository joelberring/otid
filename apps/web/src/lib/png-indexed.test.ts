import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { crc32, indexedPng, quantize } from "./png-indexed";

describe("indexedPng", () => {
  it("skriver en PNG med palett, genomskinlighet och rätt bildpunkter", async () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 0, 200, 100, 50, 255, 200, 100, 50, 120, 10, 10, 10, 0]);
    const { indices, palette } = quantize(rgba, [[200, 100, 50]], 4);
    expect([...indices]).toEqual([0, 4, 2, 0]);
    const png = await indexedPng(2, 2, indices, palette);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR: 2 × 2, 8 bitar, färgtyp 3; CRC stämmer.
    const view = new DataView(png.buffer);
    expect(view.getUint32(16)).toBe(2);
    expect(png[25]).toBe(3);
    expect(view.getUint32(29)).toBe((crc32(png.subarray(12, 29)) ^ 0xffffffff) >>> 0);
    // Bildpunkterna ur IDAT.
    const text = new TextDecoder("latin1").decode(png);
    const at = text.indexOf("IDAT"), length = view.getUint32(at - 4);
    expect([...inflateSync(png.subarray(at + 4, at + 4 + length))]).toEqual([0, 0, 4, 0, 2, 0]);
  });
});

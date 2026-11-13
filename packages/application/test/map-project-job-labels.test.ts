import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { decodeRgbaPng, isom2000To2017, rgbaPng, usesIsom2000 } from "../src/map-project-job-labels";

describe("klassrastret och äldre symbolnummer", () => {
  it("känner igen ISOM 2000 på ytor med 526, 527 eller 529", () => {
    expect(usesIsom2000([101, 310, 526])).toBe(true);
    expect(usesIsom2000([403, 521, 520, 501])).toBe(false);
  });
  it("räknar om punkthöjd, sankmark, berg i dagen och byggnad till ISOM 2017-2", () => {
    expect([112, 113, 310, 311, 309, 212, 526, 527, 529, 507].map(isom2000To2017)).toEqual([109, 110, 308, 310, 307, 214, 521, 520, 501, 506]);
    expect([101, 403, 406].map(isom2000To2017)).toEqual([101, 403, 406]);
  });
});

describe("PNG till råa bildpunkter (laserkörningens fuktdjup)", () => {
  const rgba = Uint8Array.from({ length: 5 * 3 * 4 }, (_, i) => (i * 37 + 11) % 256);
  it("läser tillbaka det som `rgbaPng` skriver", () => {
    expect(decodeRgbaPng(rgbaPng(5, 3, rgba))).toEqual({ width: 5, height: 3, data: rgba });
  });
  it("tar bort radernas filter (Sub, Up, Average och Paeth)", () => {
    // Samma bild med ett filter per rad, kodad för hand.
    const width = 4, height = 5, stride = width * 4, pixels = Uint8Array.from({ length: height * stride }, (_, i) => (i * 53 + i * i) % 256);
    const raw = Buffer.alloc(height * (stride + 1));
    for (let row = 0; row < height; row += 1) {
      const filter = row % 5;
      raw[row * (stride + 1)] = filter;
      for (let i = 0; i < stride; i += 1) {
        const left = i >= 4 ? pixels[row * stride + i - 4]! : 0, up = row > 0 ? pixels[(row - 1) * stride + i]! : 0, corner = row > 0 && i >= 4 ? pixels[(row - 1) * stride + i - 4]! : 0;
        const guess = left + up - corner, a = Math.abs(guess - left), b = Math.abs(guess - up), c = Math.abs(guess - corner);
        const predicted = [0, left, up, (left + up) >> 1, a <= b && a <= c ? left : b <= c ? up : corner][filter]!;
        raw[row * (stride + 1) + 1 + i] = (pixels[row * stride + i]! - predicted) & 255;
      }
    }
    const plain = Buffer.from(rgbaPng(width, height, pixels)), idat = plain.indexOf("IDAT"), length = plain.readUInt32BE(idat - 4);
    const packed = deflateSync(raw), size = Buffer.alloc(4);
    size.writeUInt32BE(packed.length, 0);
    // Kontrollsumman läses inte av avkodaren, så den gamla får stå kvar.
    const png = Buffer.concat([plain.subarray(0, idat - 4), size, Buffer.from("IDAT"), packed, plain.subarray(idat + 4 + length)]);
    expect(decodeRgbaPng(png)).toEqual({ width, height, data: pixels });
  });
  it("ger inget för annat än en PNG eller en avkortad fil", () => {
    expect(decodeRgbaPng(new Uint8Array(40))).toBeUndefined();
    expect(decodeRgbaPng(rgbaPng(5, 3, rgba).subarray(0, 50))).toBeUndefined();
  });
});

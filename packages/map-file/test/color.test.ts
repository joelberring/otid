import { describe, expect, it } from "vitest";
import { readMapFile } from "../src";
import { rgbFromCmyk } from "../src/color";
import { buildOcd } from "./ocd-builder";

const bytes = (rgb: { r: number; g: number; b: number }) => [rgb.r, rgb.g, rgb.b].map(value => Math.round(value * 255));
const cmyk = (c: number, m: number, y: number, k: number) => ({ c: c / 100, m: m / 100, y: y / 100, k: k / 100 });

describe("skärmfärg ur CMYK (SWOP som Purple Pen)", () => {
  it("ger Purple Pens värden för grön 406 och lila", () => {
    // Högdalen: "Grön 100 % - Ytobjekt" (C80 Y100) och "Grön 50 % - Ytobjekt" (C40 Y60, 406).
    expect(bytes(rgbFromCmyk(cmyk(80, 0, 100, 0)))).toEqual([12, 177, 75]);
    expect(bytes(rgbFromCmyk(cmyk(40, 0, 60, 0)))).toEqual([159, 209, 138]);
    // Banpåtryckets lila i Högdalen (C30 M100) och Djurgården (C35 M85).
    expect(bytes(rgbFromCmyk(cmyk(30, 100, 0, 0)))).toEqual([180, 29, 142]);
    expect(bytes(rgbFromCmyk(cmyk(35, 85, 0, 0)))).toEqual([171, 74, 156]);
  });

  it("interpolerar mellan tabellens steg (PMS 361 grön, C76 Y91)", () => {
    const [r, g, b] = bytes(rgbFromCmyk(cmyk(76, 0, 91, 0)));
    expect(Math.abs(r! - 32)).toBeLessThanOrEqual(1);
    expect(Math.abs(g! - 180)).toBeLessThanOrEqual(1);
    expect(Math.abs(b! - 87)).toBeLessThanOrEqual(1);
  });

  it("blir inte neongrön som den naiva omräkningen", () => {
    const naive = { r: (1 - 0.76), g: 1, b: (1 - 0.91) };
    const screen = rgbFromCmyk(cmyk(76, 0, 91, 0));
    expect(naive.g).toBe(1);
    expect(screen.g).toBeLessThan(0.75);
    expect(screen.r).toBeGreaterThan(0.1);
  });

  it("ger rent svart för K 100 och rent vitt utan färg, och klarar värden utanför 0–1", () => {
    expect(rgbFromCmyk(cmyk(0, 0, 0, 100))).toEqual({ r: 0, g: 0, b: 0 });
    expect(rgbFromCmyk(cmyk(30, 30, 30, 100))).toEqual({ r: 0, g: 0, b: 0 });
    expect(rgbFromCmyk(cmyk(0, 0, 0, 0))).toEqual({ r: 1, g: 1, b: 1 });
    expect(rgbFromCmyk({ c: 1.5, m: -1, y: Number.NaN, k: 0 })).toEqual(rgbFromCmyk({ c: 1, m: 0, y: 0, k: 0 }));
    expect(bytes(rgbFromCmyk(cmyk(100, 0, 0, 0)))).toEqual([0, 174, 239]);
    expect(bytes(rgbFromCmyk(cmyk(0, 0, 0, 50)))).toEqual([147, 149, 152]);
  });

  it("räknar OCAD-filens färger så och behåller CMYK för tryck", () => {
    const map = readMapFile(buildOcd({ strings: [{ type: 9, value: "Grön 100%\tn26\ty100\tc80\tm0\tk0\to0\tt100" }] }), "test.ocd");
    expect(map.colors[0]!.cmyk).toEqual({ c: 0.8, m: 0, y: 1, k: 0 });
    expect(bytes(map.colors[0]!.rgb)).toEqual([12, 177, 75]);
  });
});

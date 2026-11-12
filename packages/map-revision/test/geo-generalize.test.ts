import { describe, expect, it } from "vitest";
import { fillSmallForest, smoothMask } from "../../../scripts/geo-generalize.ts";
import { smoothMask as browserSmooth } from "../../../apps/web/src/lib/map-project-mask-smooth";

const mask = (width: number, height: number, test: (x: number, y: number) => boolean) => {
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) if (test(x, y)) out[x * height + y] = 1;
  return out;
};
const count = (cells: Uint8Array) => cells.reduce((sum, cell) => sum + cell, 0);

describe("vegetationens generalisering", () => {
  it("fyller hack och hål och tar bort flikar, men låter en stor yta vara", () => {
    // En kvadrat 30 × 30 med ett hack (2 brett), ett hål (2 × 2) och en flik (2 bred) ut åt höger.
    const shape = mask(60, 60, (x, y) => (x >= 10 && x < 40 && y >= 10 && y < 40 && !(x >= 20 && x < 22 && y >= 30) && !(x >= 28 && x < 30 && y >= 20 && y < 22))
      || (x >= 40 && x < 55 && y >= 24 && y < 26));
    const smooth = smoothMask(shape, 60, 60, 3);
    expect(smooth[21 * 60 + 35]).toBe(1);
    expect(smooth[28 * 60 + 20]).toBe(1);
    expect(smooth[50 * 60 + 24]).toBe(0);
    expect(count(smooth)).toBeGreaterThan(850);
    expect(count(smooth)).toBeLessThanOrEqual(900);
  });
  it("krymper inte en yta från bildens kant, och en mindre öppning behåller smala remsor", () => {
    const edge = mask(20, 20, x => x < 8);
    expect(count(smoothMask(edge, 20, 20, 3))).toBe(160);
    const strip = mask(40, 40, (x, y) => y >= 18 && y < 22);
    expect(count(smoothMask(strip, 40, 40, 3))).toBe(0);
    expect(count(smoothMask(strip, 40, 40, 3, undefined, 1))).toBe(160);
  });
  it("räknar likadant i webbläsaren", () => {
    const shape = mask(50, 40, (x, y) => (x * 7 + y * 13) % 5 < 2 || (x > 10 && x < 30 && y > 8 && y < 30));
    expect([...browserSmooth(shape, 50, 40, 3, 1)]).toEqual([...smoothMask(shape, 50, 40, 3, undefined, 1)]);
  });
  it("ger en liten vit yta till grannen där färgen dominerar, men inte i en vit mosaik", () => {
    // Grönt överallt utom en vit lucka 4 × 4: luckan fylls.
    const green = mask(40, 40, (x, y) => !(x >= 18 && x < 22 && y >= 18 && y < 22)), open = new Uint8Array(1600);
    expect(fillSmallForest(open, green, undefined, 40, 40, 75)).toBe(16);
    expect(count(green)).toBe(1600);
    // Smala gröna ränder i mest vitt: de små vita rutorna mellan dem lämnas.
    const lace = mask(40, 40, (x, y) => x % 8 === 0 || y % 8 === 0), none = new Uint8Array(1600);
    expect(fillSmallForest(none, lace, undefined, 40, 40, 75)).toBe(0);
  });
});

describe("branternas linjer", () => {
  it("jämnar ut en sicksackande linje och behåller ändarna", async () => {
    const { evenLine } = await import("../../../scripts/geo-cliffs.ts");
    const zigzag = Array.from({ length: 21 }, (_, i) => [i * 2, i % 2 === 0 ? 0 : 1.5] as [number, number]);
    const even = evenLine(zigzag);
    expect(even[0]).toEqual([0, 0]);
    expect(even[even.length - 1]).toEqual([40, 0]);
    expect(even.length).toBeLessThan(8);
    for (const [, y] of even) expect(Math.abs(y - 0.75)).toBeLessThan(0.8);
  });
});

import { describe, expect, it } from "vitest";
import { fillHoles, simplification, smoothMask, smoothMaskWide } from "./map-project-mask-smooth";

/** Ägaren 2026-11-14: förenklingen av grönt (stora radier) räknas med avstånd, och små hål fylls. */
describe("utjämning av masker", () => {
  const columns = 60, rows = 60;
  const mask = (test: (x: number, y: number) => boolean) => Uint8Array.from({ length: columns * rows }, (_, i) => test(Math.floor(i / rows), i % rows) ? 1 : 0);
  const area = (cells: Uint8Array) => cells.reduce((sum, cell) => sum + cell, 0);
  it("den breda utjämningen sluter en vik och tar bort en arm, som den stegvisa", () => {
    const shape = mask((x, y) => (x >= 15 && x < 45 && y >= 15 && y < 45 && !(x >= 28 && x < 32 && y >= 15 && y < 35)) || (x >= 45 && x < 58 && y >= 29 && y < 31));
    for (const smooth of [smoothMask, smoothMaskWide]) {
      const out = smooth(shape, columns, rows, 3, 3);
      expect([out[30 * rows + 25], out[52 * rows + 30], out[20 * rows + 20]]).toEqual([1, 0, 1]);
    }
    // Ytan skiljer sig bara i hörnen.
    expect(Math.abs(area(smoothMaskWide(shape, columns, rows, 3, 3)) - area(smoothMask(shape, columns, rows, 3, 3)))).toBeLessThan(40);
  });
  it("en hel yta ändras inte av att stängas och öppnas, inte heller vid bildens kant", () => {
    const full = mask(x => x < 30);
    expect(area(smoothMaskWide(full, columns, rows, 8, 5))).toBe(area(full));
    expect(area(smoothMaskWide(new Uint8Array(columns * rows), columns, rows, 8, 5))).toBe(0);
  });
  it("fyller små hål men inte stora, och inte det som når kanten", () => {
    const holes = mask((x, y) => !(x >= 10 && x < 12 && y >= 10 && y < 12) && !(x >= 30 && x < 40 && y >= 30 && y < 40) && !(x < 3 && y < 3));
    const filled = fillHoles(holes, columns, rows, 10);
    expect([filled[10 * rows + 10], filled[35 * rows + 35], filled[0]]).toEqual([1, 0, 0]);
    expect(fillHoles(holes, columns, rows, 0)).toBe(holes);
  });
  it("förenklingen växer med läget och räknas i meter", () => {
    expect(simplification(0, 2)).toEqual({ close: 3, open: 3, holeCells: 0, areaFactor: 1, tolerance: 0.75 });
    const five = simplification(5, 2), ten = simplification(10, 2);
    expect(ten.close).toBeGreaterThan(five.close);
    expect(ten.holeCells).toBe(625);
    expect(simplification(10, 1).close).toBeGreaterThan(ten.close);
  });
});

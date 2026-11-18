import { describe, expect, it } from "vitest";
import { interpretPhotoWithLaser, PHOTO_LASER_LAYERS } from "../src/base-map/photo-laser";
import type { GridPart } from "../src/base-map/drawing-basis";

/** 100 × 100 m i 1 m-bildpunkter (falskfärg: R = IR, G = rött), laserns rutnät i 2 m, SWEREF med origo i (0, 100). */
const side = 100;
function scene(paint: (x: number, y: number) => { nir: number; red: number; veg: number; wet: number }) {
  const data = new Uint8ClampedArray(side * side * 4);
  const vegetation = new Float32Array(50 * 50), wet = new Float32Array(50 * 50);
  for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) {
    const p = paint(x, y), i = (y * side + x) * 4;
    data[i] = p.nir; data[i + 1] = p.red; data[i + 2] = 80; data[i + 3] = 255;
    if (x % 2 === 0 && y % 2 === 0) { vegetation[(y / 2) * 50 + x / 2] = p.veg; wet[(y / 2) * 50 + x / 2] = p.wet; }
  }
  const part = (meters: Float32Array): GridPart => ({ grid: { columns: 50, rows: 50, meters }, affine: [2, 0, 1, 0, -2, 99] });
  return { pixels: { width: side, height: side, data }, laser: { vegetation: part(vegetation), wet: part(wet) } };
}
const toSource = (column: number, row: number): [number, number] => [column, side - row];
const area = (result: ReturnType<typeof interpretPhotoWithLaser>, layer: string) => result.data.features.filter(feature => feature.layer === layer).length;

describe("flygbilden med lasern (ägaren 2026-11-18)", () => {
  // Skog överallt; en glänta (låg vegetation, levande grönt) 10–40 m, en kal häll (låg vegetation, lägst NDVI, torr) 60–90 m,
  // och en lucka i skogen med levande krontak 40–55 i y-led längst ner (lasern utan krona men grönt i fotot).
  const { pixels, laser } = scene((x, y) => {
    const glade = x >= 10 && x < 40 && y >= 10 && y < 40, rock = x >= 60 && x < 90 && y >= 10 && y < 40, gap = x >= 20 && x < 80 && y >= 70 && y < 90;
    if (rock) return { nir: 90, red: 110, veg: 0.2, wet: 3 };
    if (glade) return { nir: 140, red: 90, veg: 0.3, wet: 3 };
    if (gap) return { nir: 230, red: 60, veg: 0.5, wet: 3 };
    return { nir: 170 + ((x * 7 + y * 13) % 20), red: 80, veg: 15, wet: 3 };
  });
  it("hällen blir berg i dagen, gläntan öppen mark och luckan med levande krontak ingenting", () => {
    const result = interpretPhotoWithLaser(pixels, { cellPixels: 2, minCells: 10, infrared: true, rockPercentile: 10 }, toSource, 3006, laser);
    expect(area(result, PHOTO_LASER_LAYERS.rock)).toBe(1);
    expect(area(result, PHOTO_LASER_LAYERS.open)).toBe(1);
    expect(result.rockCells).toBeGreaterThan(150);
    expect(result.openCells).toBeGreaterThan(150);
    expect(result.openCells).toBeLessThan(260);
  });
  it("utan IR blir allt öppet laserns öppna mark och inget berg", () => {
    const result = interpretPhotoWithLaser(pixels, { cellPixels: 2, minCells: 10, infrared: false, rockPercentile: 10 }, toSource, 3006, laser);
    expect(result.rockCells).toBe(0);
    expect(result.openCells).toBeGreaterThan(600);
  });
  it("blöt mark blir inte berg", () => {
    const { pixels: wetPixels, laser: wetLaser } = scene((x, y) => x >= 60 && x < 90 && y >= 10 && y < 40 ? { nir: 90, red: 110, veg: 0.2, wet: 0.1 } : { nir: 170, red: 80, veg: 15, wet: 3 });
    expect(interpretPhotoWithLaser(wetPixels, { cellPixels: 2, minCells: 10, infrared: true, rockPercentile: 10 }, toSource, 3006, wetLaser).rockCells).toBe(0);
  });
});

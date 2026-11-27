import { describe, expect, it } from "vitest";
import type { GroundGrid } from "../../../scripts/geo-cliffs";
import { decodePng } from "../../../scripts/geo-merge";
import { distanceToMask, rockImage, roughnessGrid } from "../../../scripts/geo-rock";
import { rockAreasOfJob, worldFileAffine } from "../src/base-map";

/** PNG (RGBA, 8 bitar, inkl. Sub/Up-filter från `encodePng`) som råa bildpunkter radvis uppifrån. */
function decodeRgbaPng(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const png = decodePng(bytes);
  expect(png.colorType).toBe(6);
  expect(png.bitDepth).toBe(8);
  return { width: png.width, height: png.height, data: png.data };
}

/** 60 × 40 m: ojämn häll (x 5–30), slät mark, och vatten vid x ≥ 50. */
function ground(): GroundGrid {
  const width = 60, height = 40, z = new Float32Array(width * height);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    const rough = x >= 5 && x < 30 ? 0.3 * Math.sin(x * 1.7) * Math.cos(y * 2.3) : 0;
    z[x * height + y] = 10 + rough;
  }
  return { minX: 1000, minY: 2000, cell: 1, width, height, z };
}

describe("bergbilden berg.png ur markrastret", () => {
  it("avståndet till en markerad cell är rutavstånd i meter, och oändligt utan någon", () => {
    const mask = new Uint8Array(21 * 21);
    mask[10 * 21 + 10] = 1;
    const far = distanceToMask(mask, 21, 21, 2);
    expect(far[10 * 21 + 10]).toBe(0);
    expect(far[10 * 21 + 13]).toBeCloseTo(6, 5);
    expect(far[13 * 21 + 13]).toBeCloseTo(8, 5);
    expect(distanceToMask(new Uint8Array(9), 3, 3, 1)[0]).toBe(Number.POSITIVE_INFINITY);
  });
  it("skriver ojämnhet, öppenhet och avstånd till vatten som bildens kanaler, och rutnätet i världsfilen", () => {
    const grid = ground(), width = grid.width, height = grid.height;
    const open = new Uint8Array(width * height), water = new Uint8Array(width * height);
    for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
      if (x < 40) open[x * height + y] = 1;
      if (x >= 50) water[x * height + y] = 1;
    }
    const image = rockImage(grid, open, water);
    const decoded = decodeRgbaPng(image.png);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    // Bildens översta rad är den nordligaste; cell (x, y) ligger i rad height − 1 − y.
    const at = (x: number, y: number) => { const i = ((height - 1 - y) * width + x) * 4; return [...decoded.data.subarray(i, i + 4)]; };
    const rough = roughnessGrid(grid);
    const [r = 0, g = 0, b = 0, a = 0] = at(15, 20);
    expect(a).toBe(255);
    expect(r).toBe(Math.min(255, Math.round(rough[15 * height + 20]! * 1000)));
    expect(r).toBeGreaterThan(40);
    expect(g & 128).toBe(128);
    expect(b).toBe(35);
    // Slät öppen mark 12 m från vattnet; slät mark utanför det öppna (5 m från vattnet): inte öppen. Vatten och kanten: genomskinligt.
    expect(at(38, 20)[0]).toBe(0);
    expect(at(38, 20)[1]! & 128).toBe(128);
    expect(at(38, 20)[2]).toBe(12);
    expect(at(45, 20)).toEqual([0, 0, 5, 255]);
    expect(at(55, 20)[3]).toBe(0);
    expect(at(0, 0)[3]).toBe(0);
    expect(image.world).toBe("1\n0\n0\n-1\n1000.5\n2039.5\n");
  });
  it("utan vatten är avståndet 255 (inget vatten), och rundturen ger berget tillbaka med regeln", () => {
    const grid = ground(), open = new Uint8Array(grid.width * grid.height).fill(1);
    const image = rockImage(grid, open, undefined);
    const decoded = decodeRgbaPng(image.png);
    expect(decoded.data[(20 * grid.width + 45) * 4 + 2]).toBe(255);
    // Nivå 10 tar hällen (ojämnhet över 0,04 m) men inte den släta marken.
    const found = rockAreasOfJob(decoded, worldFileAffine(image.world)!, 10);
    expect(found.areas).toBeGreaterThan(0);
    const xs = found.data.features.flatMap(feature => feature.geometry.kind === "line" ? feature.geometry.points.map(point => point[0]) : []);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1002);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1034);
  });
});

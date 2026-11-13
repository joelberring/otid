import { describe, expect, it } from "vitest";
import { encodeRockCell } from "../../../scripts/geo-rock";
import type { SourceData } from "../src";
import { DEFAULT_ROCK_LEVEL, fillSmallHoles, rockAreas, rockAreasOfJob, rockLimitsAt, rockMask, withRockAreas, type PhotoPixels } from "../src/base-map";

/** Bildpunkter (1 m-celler) från en funktion (kolumn, rad) → [ojämnhet m, öppen, höjd m, avstånd till vatten m] eller inget (genomskinligt). */
function raster(columns: number, rows: number, cell: (column: number, row: number) => readonly [number, boolean, number, number] | undefined): PhotoPixels {
  const data = new Uint8Array(columns * rows * 4);
  for (let column = 0; column < columns; column += 1) for (let row = 0; row < rows; row += 1) {
    const value = cell(column, row);
    if (!value) continue;
    const [r, g, b] = encodeRockCell(...value), i = (row * columns + column) * 4;
    data.set([r, g, b, 255], i);
  }
  return { width: columns, height: rows, data };
}
const count = (mask: Uint8Array) => mask.reduce((sum, value) => sum + value, 0);
const identity = (column: number, row: number): [number, number] => [column, row];
const areasAt = (pixels: PhotoPixels, level: number) => rockAreas(pixels, level, 1, identity, 3006).areas;

describe("berg i dagen med reglage: rastrets kodning", () => {
  it("ger ojämnheten i mm, öppenheten med höjden i dm och avståndet till vatten", () => {
    expect(encodeRockCell(0.0734, true, 1.26, 12.4)).toEqual([73, 128 + 13, 12]);
    expect(encodeRockCell(0.0734, false, 1.26, 12.4)).toEqual([73, 13, 12]);
  });
  it("klipper värdena till kanalernas gränser", () => {
    expect(encodeRockCell(0.5, true, 40, 0)).toEqual([255, 255, 0]);
    expect(encodeRockCell(-1, false, -3, 254)).toEqual([0, 0, 254]);
  });
  it("255 betyder inget vatten inom 254 m", () => {
    expect(encodeRockCell(0.1, true, 0, Number.POSITIVE_INFINITY)[2]).toBe(255);
    expect(encodeRockCell(0.1, true, 0, 300)[2]).toBe(255);
  });
  it("avkodningen ger samma val som värdena den kodades ur (rundtur)", () => {
    // Ojämnhet 0,12 m går just med på nivå 1; 0,119 m går inte.
    expect(count(rockMask(raster(4, 4, () => [0.12, true, 0, 255]), 1))).toBe(16);
    expect(count(rockMask(raster(4, 4, () => [0.119, true, 0, 255]), 1))).toBe(0);
    // Höjden 0,4 m i skog (nivå 10) går, 0,3 m går inte (högre än 0,3 m krävs).
    expect(count(rockMask(raster(4, 4, () => [0.2, false, 0.4, 255]), 10))).toBe(16);
    expect(count(rockMask(raster(4, 4, () => [0.2, false, 0.3, 255]), 10))).toBe(0);
  });
});

describe("berg i dagen med reglage: regeln", () => {
  it("gränserna går rätlinjigt från nivå 1 till 10, och förvalet är nivå 3", () => {
    expect(DEFAULT_ROCK_LEVEL).toBe(3);
    expect(rockLimitsAt(1)).toMatchObject({ roughness: 0.12, shoreMeters: 0, shoreRise: 1.5, minAreaM2: 200, forest: false });
    expect(rockLimitsAt(10)).toMatchObject({ shoreMeters: 40, minAreaM2: 50, forest: true });
    expect(rockLimitsAt(10).roughness).toBeCloseTo(0.04, 9);
    expect(rockLimitsAt(10).shoreRise).toBeCloseTo(0.3, 9);
    expect(rockLimitsAt(3).roughness).toBeCloseTo(0.12 - 0.08 * 2 / 9, 6);
  });
  it("nivå 1 tar bara mycket ojämn öppen mark, och en högre nivå tar minst lika mycket", () => {
    // Fyra remsor med ojämnheten 0,13, 0,09, 0,06 och 0,03 m; öppna.
    const pixels = raster(40, 40, column => [[0.13, 0.09, 0.06, 0.03][Math.floor(column / 10)]!, true, 0, 255]);
    expect(count(rockMask(pixels, 1))).toBe(400);
    expect(count(rockMask(pixels, 10))).toBe(1200);
    let before = 0;
    for (let level = 1; level <= 10; level += 1) {
      const now = count(rockMask(pixels, level));
      expect(now).toBeGreaterThanOrEqual(before);
      before = now;
    }
  });
  it("strandregeln gäller bara nära vatten och bara från nivå 2", () => {
    // Slät häll, 1,5 m över omgivningen.
    const near = (water: number) => raster(30, 30, () => [0, true, 1.5, water]);
    expect(count(rockMask(near(3), 1))).toBe(0);
    expect(count(rockMask(near(3), 2))).toBe(900);
    expect(count(rockMask(near(30), 2))).toBe(0);
    expect(count(rockMask(near(30), 5))).toBe(0);
    expect(count(rockMask(near(30), 10))).toBe(900);
    for (let level = 1; level <= 10; level += 1) expect(count(rockMask(near(100), level))).toBe(0);
    expect(count(rockMask(near(255), 10))).toBe(0);
    // Utan höjd men med viss ojämnhet (0,6 av gränsen): nivå 10 har gränsen 0,04 m, så 0,03 m vid vattnet går, 0,03 m långt bort inte.
    expect(count(rockMask(raster(10, 10, () => [0.03, true, 0, 5]), 10))).toBe(100);
    expect(count(rockMask(raster(10, 10, () => [0.03, true, 0, 200]), 10))).toBe(0);
  });
  it("skogsregeln gäller bara från nivå 6, med strängare krav", () => {
    const forest = (roughness: number, rise: number) => raster(20, 20, () => [roughness, false, rise, 255]);
    for (let level = 1; level <= 5; level += 1) expect(count(rockMask(forest(0.2, 0.6), level))).toBe(0);
    expect(count(rockMask(forest(0.2, 0.6), 6))).toBe(400);
    // Ojämnare än gränsen men inte 1,5 gånger (nivå 6: 0,0756 · 1,5 = 0,113), eller för låg.
    expect(count(rockMask(forest(0.1, 0.6), 6))).toBe(0);
    expect(count(rockMask(forest(0.2, 0.2), 10))).toBe(0);
  });
  it("tar bort ytor under minsta ytan och fyller små hål", () => {
    const small = raster(40, 40, (column, row) => [column < 10 && row < 10 ? 0.2 : 0, true, 0, 255]);
    expect(areasAt(small, 1)).toBe(0);
    const big = raster(40, 40, (column, row) => [column < 30 && row < 30 ? 0.2 : 0, true, 0, 255]);
    expect(areasAt(big, 1)).toBe(1);
    // Ett hål på 2 × 2 celler blir inte en egen ring; ett stort hål blir det.
    const holed = (size: number) => raster(40, 40, (column, row) => [column < 30 && row < 30 && !(column >= 10 && column < 10 + size && row >= 10 && row < 10 + size) ? 0.2 : 0, true, 0, 255]);
    expect(rockAreas(holed(2), 1, 1, identity, 3006).data.features).toHaveLength(1);
    expect(rockAreas(holed(15), 1, 1, identity, 3006).data.features).toHaveLength(2);
  });
  it("ger ytorna som slutna ringar i lagret berg_i_dagen med hektar", () => {
    const result = rockAreas(raster(40, 40, column => [column < 30 ? 0.2 : 0, true, 0, 255]), 1, 1, identity, 3006);
    expect(result.areas).toBe(1);
    expect(result.data.crs).toBe(3006);
    expect(result.data.features[0]).toMatchObject({ layer: "berg_i_dagen", geometry: { kind: "line", closed: true } });
    expect(result.hectares).toBe(0.12);
  });
  it("fyller hål men låter hål vid kanten vara", () => {
    const mask = new Uint8Array(25).fill(1);
    mask[12] = 0; mask[0] = 0;
    const filled = fillSmallHoles(mask, 5, 5, 10);
    expect(filled[12]).toBe(1);
    expect(filled[0]).toBe(0);
  });
  it("lägger ytorna i världsfilens koordinater (bildpunktens mitt, hörnen en halv cell ut)", () => {
    const pixels = raster(40, 40, column => [column < 30 ? 0.2 : 0, true, 0, 255]);
    const found = rockAreasOfJob(pixels, [1, 0, 1000.5, 0, -1, 2000.5], 1);
    const points = found.data.features.flatMap(feature => feature.geometry.kind === "line" ? feature.geometry.points : []);
    // Kolumn 0 börjar vid x 1000, kolumn 30 vid x 1030; rad 0 är den nordligaste, med överkanten vid y 2001.
    expect(Math.min(...points.map(point => point[0]))).toBe(1000);
    expect(Math.max(...points.map(point => point[0]))).toBe(1030);
    expect(Math.max(...points.map(point => point[1]))).toBe(2001);
  });
});

describe("berg i dagen ersätter laserfilens berg", () => {
  const rock: SourceData = { features: [{ layer: "berg_i_dagen", geometry: { kind: "line", closed: true, points: [[0, 0], [1, 0], [1, 1], [0, 0]] } }], skipped: 0, crs: 3006 };
  const file: SourceData = { crs: 3006, skipped: 0, features: [
    { layer: "berg_i_dagen_laser", geometry: { kind: "line", closed: true, points: [[5, 5], [6, 5], [6, 6], [5, 5]] } },
    { layer: "sten", geometry: { kind: "point", at: [2, 2] } }] };
  it("byter berg i dagen i berg.dxf men låter stenarna stå kvar", () => {
    const parts = withRockAreas([{ name: "kurvor.dxf", data: { features: [], skipped: 0 } }, { name: "berg.dxf", data: file }], rock);
    const features = parts.find(part => part.name === "berg.dxf")!.data.features;
    expect(features.map(feature => feature.layer).sort()).toEqual(["berg_i_dagen", "sten"]);
    expect(parts).toHaveLength(2);
  });
  it("lägger till en berg.dxf när jobbet inte hade någon", () => {
    const parts = withRockAreas([{ name: "kurvor.dxf", data: { features: [], skipped: 0 } }], rock);
    expect(parts.map(part => part.name)).toEqual(["kurvor.dxf", "berg.dxf"]);
    expect(parts[1]!.data.features).toHaveLength(1);
  });
});

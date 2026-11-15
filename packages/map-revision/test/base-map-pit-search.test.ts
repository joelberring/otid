import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { suggestSymbol } from "../src";
import type { HeightGrid } from "../src/base-map/clear-contours";
import { depressionRing } from "../src/base-map/depressions";
import { choosePits, DEFAULT_PIT_LIMITS, findPits, PIT_LAYERS, pitFeatures, pitLimitsAt, type PitCandidate } from "../src/base-map/pit-search";
import { ringArea } from "../src/base-map/small-rings";

/** Ett raster med 1 m celler: en sluttning (1 % österut) med gropar; `hole` = [kolumn, rad, radie, djup]. Rad 0 är norr. */
function terrain(columns: number, rows: number, holes: readonly (readonly [number, number, number, number])[], lake?: readonly [number, number, number]): HeightGrid {
  const meters = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    let z = 100 + column * 0.01;
    for (const [c, r, radius, depth] of holes) { const d = Math.hypot(column - c, row - r); if (d < radius) z -= depth * (1 - (d / radius) ** 2); }
    if (lake && Math.hypot(column - lake[0], row - lake[1]) < lake[2]) z = NaN;
    meters[row * columns + column] = z;
  }
  return { columns, rows, meters };
}
/** Bildpunkten (0, 0) har mitten i (1000,5; 1999,5): x österut, y norrut. */
const affine = [1, 0, 1000.5, 0, -1, 1999.5] as const;
const pit = (x: number, y: number, depth: number, areaM2: number, ring?: [number, number][]): PitCandidate => ({ at: [x, y], depth, areaM2, length: 10, width: 10, ...(ring ? { ring } : {}) });
const circle = (cx: number, cy: number, r: number): [number, number][] => Array.from({ length: 24 }, (_, i) => [cx + r * Math.cos(i * Math.PI / 12), cy + r * Math.sin(i * Math.PI / 12)]);

describe("sänkor ur höjdrastret", () => {
  it("hittar en sluten sänka med djup, läge och yta, oavsett vilken nivå den ligger på", () => {
    const found = findPits(terrain(80, 60, [[40, 30, 6, 1.5]]), affine);
    expect(found).toHaveLength(1);
    const [only] = found;
    expect(only!.at[0]).toBeGreaterThan(1039); expect(only!.at[0]).toBeLessThan(1042);
    expect(only!.at[1]).toBeGreaterThan(1968); expect(only!.at[1]).toBeLessThan(1971);
    expect(only!.depth).toBeGreaterThan(1.2); expect(only!.depth).toBeLessThan(1.5);
    expect(only!.areaM2).toBeGreaterThan(60); expect(only!.areaM2).toBeLessThan(113);
  });
  it("en sluttning utan gropar ger inga kandidater, och en grund svacka under 0,3 m sparas inte", () => {
    expect(findPits(terrain(60, 60, []), affine)).toEqual([]);
    expect(findPits(terrain(60, 60, [[30, 30, 6, 0.25]]), affine)).toEqual([]);
  });
  it("en svacka som öppnar sig mot en sjö (ingen höjd) är ingen sänka", () => {
    expect(findPits(terrain(80, 60, [[40, 30, 8, 1.5]], [47, 30, 4]), affine)).toEqual([]);
  });
  it("en djup och stor sänka får sin kant sparad: en sluten ring runt botten som marken sluttar in i", () => {
    const grid = terrain(100, 80, [[50, 40, 14, 2]]);
    const [only] = findPits(grid, affine);
    expect(only!.ring).toBeDefined();
    const ring = only!.ring!;
    expect(ringArea(ring)).toBeGreaterThan(250); expect(ringArea(ring)).toBeLessThan(616);
    for (const [x, y] of ring) expect(Math.abs(Math.hypot(x - 1050.5, y - 1959.5) - Math.sqrt(ringArea(ring) / Math.PI))).toBeLessThan(2);
    const heightAt = (x: number, y: number) => { const column = Math.round(x - 1000.5), row = Math.round(1999.5 - y); return grid.meters[row * 100 + column]; };
    expect(depressionRing(ring, { heightAt })).toBe(true);
  });
  it("långsmala sänkor får längd och bredd efter formen", () => {
    const trench = terrain(120, 60, Array.from({ length: 9 }, (_, i) => [40 + i * 5, 30, 6, 1] as const));
    const [only] = findPits(trench, affine);
    expect(only!.length).toBeGreaterThan(2 * only!.width);
  });
});

describe("valet bland sänkorna", () => {
  it("förvalen: gropsymbol från 0,4 m, ring från 1 m när kanten rymmer normens minsta grop", () => {
    expect(pitLimitsAt(5)).toEqual(DEFAULT_PIT_LIMITS);
    expect(DEFAULT_PIT_LIMITS).toEqual({ minDepth: 0.4, ringDepth: 1, spacing: 15 });
    // 1:15 000: normens grop är 16,5 × 10,5 m, med marginalen 19,8 × 12,6 m.
    const big = pit(0, 0, 1.4, 500, circle(0, 0, 12)), small = pit(100, 0, 1.4, 90, circle(100, 0, 5)), shallow = pit(200, 0, 0.6, 120), faint = pit(300, 0, 0.35, 80);
    const choice = choosePits([faint, shallow, small, big], DEFAULT_PIT_LIMITS, 15_000);
    expect(choice.rings).toEqual([big.ring]);
    expect(choice.points).toEqual([[100, 0], [200, 0]]);
  });
  it("1 ger få och 10 ger många", () => {
    const pits = [pit(0, 0, 2.2, 500, circle(0, 0, 12)), pit(100, 0, 1.3, 90), pit(120, 0, 0.9, 90), pit(200, 0, 0.35, 60)];
    const few = choosePits(pits, pitLimitsAt(1), 15_000), many = choosePits(pits, pitLimitsAt(10), 15_000);
    expect(few.rings).toHaveLength(1); expect(few.points).toEqual([[100, 0]]);
    expect(many.points).toEqual([[100, 0], [120, 0], [200, 0]]);
  });
  it("två gropsymboler ligger aldrig närmare än avståndet, och den djupaste vinner", () => {
    expect(choosePits([pit(0, 0, 0.6, 50), pit(10, 0, 0.9, 50), pit(30, 0, 0.7, 50)], DEFAULT_PIT_LIMITS, 15_000).points).toEqual([[10, 0], [30, 0]]);
  });
  it("stora flacka svackor blir varken gropsymbol eller ring", () => {
    expect(choosePits([pit(0, 0, 0.7, 2500), pit(100, 0, 1.5, 5000, circle(100, 0, 40))], DEFAULT_PIT_LIMITS, 15_000)).toEqual({ points: [], rings: [] });
  });
  it("det grundkartan redan visar tas inte med: en liten sluten kurva runt botten eller Karttapullautins grop intill", () => {
    const ringed: SourceFeature = { layer: "depression", geometry: { kind: "line", closed: true, points: circle(0, 0, 9) } };
    const hilltop: SourceFeature = { layer: "contour", geometry: { kind: "line", closed: true, points: circle(200, 0, 60) } };
    const theirs: SourceFeature = { layer: "udepression", geometry: { kind: "point", at: [103, 2] } };
    const pits = [pit(0, 0, 0.8, 120), pit(100, 0, 0.8, 60), pit(200, 0, 0.8, 60), pit(300, 0, 0.8, 60)];
    expect(choosePits(pits, DEFAULT_PIT_LIMITS, 15_000, [ringed, hilltop, theirs]).points).toEqual([[200, 0], [300, 0]]);
  });
});

describe("sänkorna som grundkartans objekt", () => {
  const symbols = [{ id: "s111", code: "111", kind: "point" }, { id: "s103", code: "103", kind: "line" }, { id: "s101.1", code: "101.1", kind: "point" }, { id: "s101", code: "101", kind: "line" }];
  it("gropsymboler, ringar av hjälpkurva och ett lutningsstreck per ring, i egna lager som får rätt symboler", () => {
    const features = pitFeatures({ points: [[5, 5]], rings: [circle(100, 0, 12)] });
    expect(features.map(feature => feature.layer).sort()).toEqual(["formline_grop", "lutningsstreck_grop", "udepression_laser"]);
    expect(features.every(feature => PIT_LAYERS.test(feature.layer))).toBe(true);
    const tick = features.find(feature => feature.layer === "lutningsstreck_grop")!.geometry as { readonly at: readonly [number, number]; readonly toward: readonly [number, number] };
    expect(Math.hypot(tick.toward[0] - 100, tick.toward[1])).toBeLessThan(Math.hypot(tick.at[0] - 100, tick.at[1]));
    const layer = (name: string, count: Partial<{ points: number; lines: number; closedLines: number }>) => ({ name, count: 1, points: 0, lines: 0, closedLines: 0, areas: 0, ...count });
    expect(suggestSymbol(layer("udepression_laser", { points: 1 }), symbols)).toBe("s111");
    expect(suggestSymbol(layer("formline_grop", { closedLines: 1 }), symbols)).toBe("s103");
    expect(suggestSymbol(layer("lutningsstreck_grop", { points: 1 }), symbols)).toBe("s101.1");
  });
});

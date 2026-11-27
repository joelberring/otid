import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { suggestSymbol } from "../src";
import type { HeightGrid } from "../src/base-map/clear-contours";
import { chooseHills, DEFAULT_HILL_LIMITS, findHills, HILL_LAYERS, hillFeatures, hillLimitsAt, hillRingMinM2, settleHills, unsettleHills, type HillCandidate } from "../src/base-map/hill-search";
import { ringArea } from "../src/base-map/small-rings";

/** Ett raster med 1 m celler: en sluttning (`slope` m per cell österut) med kullar; `bump` = [kolumn, rad, radie, höjd]. Rad 0 är norr. */
function terrain(columns: number, rows: number, bumps: readonly (readonly [number, number, number, number])[], options: { slope?: number; lake?: readonly [number, number, number]; gap?: number } = {}): HeightGrid {
  const meters = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    let z = 100 + column * (options.slope ?? 0.01);
    for (const [c, r, radius, height] of bumps) { const d = Math.hypot(column - c, row - r); if (d < radius) z += height * (1 - (d / radius) ** 2); }
    if (options.lake && Math.hypot(column - options.lake[0], row - options.lake[1]) < options.lake[2]) z = NaN;
    if (options.gap !== undefined && column >= options.gap) z = NaN;
    meters[row * columns + column] = z;
  }
  return { columns, rows, meters };
}
/** Bildpunkten (0, 0) har mitten i (1000,5; 1999,5): x österut, y norrut. */
const affine = [1, 0, 1000.5, 0, -1, 1999.5] as const;
const circle = (cx: number, cy: number, r: number): [number, number][] => Array.from({ length: 24 }, (_, i) => [cx + r * Math.cos(i * Math.PI / 12), cy + r * Math.sin(i * Math.PI / 12)]);
const hill = (x: number, y: number, rise: number, top: number, radius: number): HillCandidate => ({ at: [x, y], top, rise, areaM2: Math.round(Math.PI * radius * radius * 2), ring: circle(x, y, radius) });
const ring = (layer: string, points: [number, number][]): SourceFeature => ({ layer, geometry: { kind: "line", closed: true, points } });
const dot = (layer: string, x: number, y: number): SourceFeature => ({ layer, geometry: { kind: "point", at: [x, y] } });

describe("höjder ur höjdrastret", () => {
  it("hittar en kulle med topp, stigning över sadeln och en ring på halva höjden, oavsett vilken nivå den ligger på", () => {
    const found = findHills(terrain(100, 80, [[50, 40, 12, 2]]), affine);
    expect(found).toHaveLength(1);
    const [only] = found;
    expect(only!.at[0]).toBeGreaterThan(1049); expect(only!.at[0]).toBeLessThan(1053);
    expect(only!.at[1]).toBeGreaterThan(1958); expect(only!.at[1]).toBeLessThan(1961);
    expect(only!.rise).toBeGreaterThan(1.6); expect(only!.rise).toBeLessThan(2);
    // Halva höjden av en paraboloid ligger vid radien 12/√2: ytan är hälften av fotens.
    const area = ringArea(only!.ring!);
    expect(area).toBeGreaterThan(170); expect(area).toBeLessThan(280);
    expect(area).toBeLessThan(only!.areaM2);
  });
  it("en jämn sluttning ger inga höjder, och en knöl under 0,4 m sparas inte", () => {
    expect(findHills(terrain(60, 60, []), affine)).toEqual([]);
    expect(findHills(terrain(60, 60, [[30, 30, 8, 0.3]]), affine)).toEqual([]);
  });
  it("en liten kulle på sidan av en större är en egen höjd; den större når kanten och tas inte med", () => {
    const found = findHills(terrain(120, 100, [[60, 50, 70, 12], [100, 50, 8, 2.5]], { slope: 0 }), affine);
    expect(found).toHaveLength(1);
    expect(found[0]!.at[0]).toBeGreaterThan(1093); expect(found[0]!.at[0]).toBeLessThan(1102);
    expect(found[0]!.rise).toBeGreaterThan(0.8); expect(found[0]!.rise).toBeLessThan(2.5);
  });
  it("en holme i en sjö är en höjd, men en höjd som når mark utan data är okänd", () => {
    const island = findHills(terrain(100, 80, [[50, 40, 8, 2]], { lake: [50, 40, 20] }), affine);
    expect(island).toHaveLength(0);
    // Sjön är hål i rastret; holmen sticker upp mitt i den.
    const grid = terrain(100, 80, [], { lake: [50, 40, 20] });
    for (let row = 34; row <= 46; row += 1) for (let column = 44; column <= 56; column += 1) {
      const d = Math.hypot(column - 50, row - 40);
      if (d < 6) grid.meters[row * 100 + column] = 100 + 1.5 * (1 - (d / 6) ** 2);
    }
    const found = findHills(grid, affine);
    expect(found).toHaveLength(1);
    expect(found[0]!.rise).toBeGreaterThan(0.8);
    // Samma kulle intill rastrets kant mot okänd mark: ingen kandidat.
    expect(findHills(terrain(100, 80, [[90, 40, 12, 2]], { gap: 92 }), affine)).toEqual([]);
  });
});

describe("valet bland höjderna", () => {
  it("minsta ringen i terrängen är normens minsta höjd i 1:15 000, också på en karta i 1:10 000", () => {
    expect(hillRingMinM2(15_000)).toBeCloseTo(95.4, 1);
    expect(hillRingMinM2(10_000)).toBeCloseTo(95.4, 1);
    expect(hillRingMinM2(4_000)).toBeCloseTo(6.8, 1);
  });
  it("en höjd på minst 0,8 m vars ring rymmer normens minsta höjd blir en ring; lägre och mindre höjder lämnas", () => {
    const chosen = chooseHills([hill(0, 0, 1.6, 43, 8), hill(100, 0, 0.65, 43, 8), hill(200, 0, 1.6, 43, 4), hill(300, 0, 0.85, 43, 8)], DEFAULT_HILL_LIMITS, 15_000);
    expect(chosen.rings).toHaveLength(2);
    expect(chosen.rings[0]!.points[0]![0]).toBeCloseTo(8, 5);
    expect(chosen.rings[1]!.points[0]![0]).toBeCloseTo(308, 5);
    expect(chooseHills([hill(100, 0, 0.65, 43, 8)], hillLimitsAt(10), 15_000).rings).toHaveLength(1);
    expect(chooseHills([hill(0, 0, 1.6, 43, 8)], hillLimitsAt(1), 15_000).rings).toHaveLength(0);
  });
  it("ringen är en höjdkurva när nivån ligger högst en fjärdedel av ekvidistansen över toppen, annars en hjälpkurva", () => {
    // Toppen 44,2 m: nivån 45 ligger 0,8 m över. Toppen 42,5 m: 2,5 m över.
    const near = chooseHills([hill(0, 0, 1.5, 44.2, 8)], DEFAULT_HILL_LIMITS, 15_000), far = chooseHills([hill(0, 0, 1.5, 42.5, 8)], DEFAULT_HILL_LIMITS, 15_000);
    expect(near.rings[0]!.contour).toBe(true);
    expect(far.rings[0]!.contour).toBe(false);
    expect(hillFeatures(near)[0]!.layer).toBe("contour_hojd");
    expect(hillFeatures(far)[0]!.layer).toBe("formline_hojd");
  });
  it("en höjd som grundkartan redan visar med en liten sluten kurva, och en höjd på en redan vald höjd, tas inte med", () => {
    const shown = ring("contour", circle(0, 0, 6)), wide = ring("contour", circle(100, 0, 60));
    const chosen = chooseHills([hill(0, 0, 2, 43, 8), hill(100, 0, 2, 43, 8), hill(203, 0, 1.2, 43, 6), hill(200, 0, 2, 43, 12)], DEFAULT_HILL_LIMITS, 15_000, [shown, wide]);
    // Den första visas redan; den andra ligger i en stor kurva som inte visar just den; av de två sista vinner den högre.
    expect(chosen.rings.map(found => Math.round(found.points[0]![0]))).toEqual([108, 212]);
    // En liten sluten hjälpkurva inne i höjdens ring (bredvid toppen) visar också höjden: inga två ringar i varandra.
    expect(chooseHills([hill(0, 0, 2, 43, 12)], DEFAULT_HILL_LIMITS, 15_000, [ring("formline", circle(6, 0, 3))]).rings).toHaveLength(0);
  });
});

describe("höjdernas ringar i grundkartan", () => {
  const symbols = [{ id: "s109", code: "109", kind: "point" }, { id: "s103", code: "103", kind: "line" }, { id: "s102", code: "102", kind: "line" }, { id: "s101", code: "101", kind: "line" }];
  it("ringen läggs till, punkthöjder i ringen tas bort och kommer tillbaka när ringen tas bort", () => {
    const features = [dot("dotknoll", 1, 1), dot("dotknoll_laser", 2, -2), dot("dotknoll", 50, 0), dot("udepression", 0, 3), ring("contour", circle(300, 0, 40))];
    const settled = settleHills(features, [hill(0, 0, 1.5, 44.2, 8)], DEFAULT_HILL_LIMITS, 15_000);
    expect(settled.rings).toBe(1); expect(settled.contours).toBe(1);
    expect(settled.hidden.map(feature => feature.layer)).toEqual(["dotknoll", "dotknoll_laser"]);
    expect(settled.features.map(feature => feature.layer)).toEqual(["dotknoll", "udepression", "contour", "contour_hojd"]);
    expect(settled.features.filter(feature => HILL_LAYERS.test(feature.layer))).toHaveLength(1);
    const back = unsettleHills(settled.features, settled.hidden);
    expect(back).toHaveLength(features.length);
    expect(new Set(back)).toEqual(new Set(features));
  });
  it("utan valda höjder står grundkartan som den var", () => {
    const features = [dot("dotknoll", 1, 1)];
    const settled = settleHills(features, [hill(0, 0, 0.5, 44.2, 8)], DEFAULT_HILL_LIMITS, 15_000);
    expect(settled.features).toEqual(features); expect(settled.hidden).toEqual([]); expect(settled.rings).toBe(0);
  });
  it("lagren får höjdkurvans och hjälpkurvans symboler", () => {
    const layer = (name: string) => ({ name, count: 1, points: 0, lines: 0, closedLines: 1, areas: 0 });
    expect(suggestSymbol(layer("contour_hojd"), symbols)).toBe("s101");
    expect(suggestSymbol(layer("formline_hojd"), symbols)).toBe("s103");
  });
  it("sprintekvidistans (2,5 m) i settleHills klassar höjdringar mot 2,5 m-nivåer, och hjälpkurvor gömmer bara punkthöjder rakt på linjen", () => {
    // Toppen 42,0 m med sadel 40,5 m: närmaste 2,5 m-nivå över sadeln är 42,5 m (0,5 m <= 0,625 m -> höjdkurva), men för 5 m-nivå är 45 m för långt bort (-> hjälpkurva).
    const sprintHill = hill(0, 0, 1.5, 42.0, 4);
    expect(settleHills([], [sprintHill], DEFAULT_HILL_LIMITS, 4_000, 2.5).contours).toBe(1);
    expect(settleHills([], [sprintHill], DEFAULT_HILL_LIMITS, 4_000, 5).contours).toBe(0);
    // Punkthöjd 3 m från en streckad hjälpkurva (1:15 000: > 2,1 m) står kvar; rakt på hjälpkurvan (1 m) eller nära höjdkurva (3 m <= 4,2 m) göms.
    const formline: SourceFeature = { layer: "formline", geometry: { kind: "line", closed: false, points: [[0, 0], [100, 0]] } };
    const contour: SourceFeature = { layer: "contour", geometry: { kind: "line", closed: false, points: [[0, 50], [100, 50]] } };
    const settled = settleHills([formline, contour, dot("dotknoll_laser", 50, 3), dot("dotknoll_laser", 60, 1), dot("dotknoll_laser", 50, 53)], [], { ringRise: 9 }, 15_000);
    expect(settled.features.filter(f => f.layer === "dotknoll_laser").map(f => (f.geometry as { at: readonly [number, number] }).at)).toEqual([[50, 3]]);
    expect(settled.hidden).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { depressionTick } from "../src/base-map/merge";
import { calmFlatContours, DEFAULT_FLAT_LEVEL, flatLimitsAt, flatSlopeFrom, restoreFlatContours, slopeGridOf, worldFileAffine } from "../src/base-map/flat-contours";

type Position = [number, number];
const line = (points: Position[], layer = "formline", closed = false): SourceFeature => ({ layer, geometry: { kind: "line", closed, points } });
const ring = (cx: number, cy: number, r: number, layer = "contour"): SourceFeature =>
  line(Array.from({ length: 24 }, (_, i) => [cx + r * Math.cos(i * Math.PI / 12), cy + r * Math.sin(i * Math.PI / 12)] as Position), layer, true);
const pointsOf = (feature: SourceFeature) => (feature.geometry as { points: readonly (readonly [number, number])[] }).points;
const lengthOf = (feature: SourceFeature) => pointsOf(feature).reduce((sum, point, i, all) => i === 0 ? 0 : sum + Math.hypot(point[0] - all[i - 1]![0], point[1] - all[i - 1]![1]), 0);
/** Brant (8°) väster om x = 0, flack (0,2°) öster om. */
const westSteep = (x: number) => x < 0 ? 8 : 0.2;
const level = (value: number) => flatLimitsAt(value);

describe("lugna kurvor på flack mark: nivåernas gränser", () => {
  it("0 är av, 1 är 0,5° och 500 m², 5 är 1,5° och 1 500 m², 10 är 4° och 5 000 m²", () => {
    expect(flatLimitsAt(0)).toBeUndefined();
    expect(flatLimitsAt(1)).toEqual({ slopeDegrees: 0.5, ringM2: 500 });
    expect(flatLimitsAt(5)).toEqual({ slopeDegrees: 1.5, ringM2: 1500 });
    expect(flatLimitsAt(10)).toEqual({ slopeDegrees: 4, ringM2: 5000 });
  });
  it("förvalet är 3 (1° och 1 000 m²) och gränserna växer med nivån", () => {
    expect(DEFAULT_FLAT_LEVEL).toBe(3);
    expect(flatLimitsAt(3)).toEqual({ slopeDegrees: 1, ringM2: 1000 });
    for (let value = 2; value <= 10; value += 1) {
      expect(flatLimitsAt(value)!.slopeDegrees).toBeGreaterThan(flatLimitsAt(value - 1)!.slopeDegrees);
      expect(flatLimitsAt(value)!.ringM2).toBeGreaterThan(flatLimitsAt(value - 1)!.ringM2);
    }
  });
});

describe("lugna kurvor på flack mark: regeln", () => {
  it("klipper en hjälpkurva vid gränsen mellan brant och flack mark och behåller den branta biten", () => {
    const formline = line([[-100, 0], [-50, 0], [50, 0], [100, 0]]);
    const out = calmFlatContours([formline], westSteep, level(3));
    expect(out.features).toHaveLength(1);
    const xs = pointsOf(out.features[0]!).map(point => point[0]);
    expect(xs[0]).toBe(-100);
    // Sista provet på brant mark: högst ett steg (5 m) väster om gränsen.
    expect(xs[xs.length - 1]).toBeLessThan(0);
    expect(xs[xs.length - 1]).toBeGreaterThanOrEqual(-5);
    expect(xs).toContain(-50);
    expect(out.formlineMeters).toBeGreaterThanOrEqual(100);
    expect(out.formlineMeters).toBeLessThanOrEqual(105);
    expect(out.removed).toEqual([formline]);
    expect(out.added).toEqual(out.features);
    expect(out.features[0]!.layer).toBe("formline");
  });
  it("tar bort en rest som är kortare än 30 m, men låter en kort flack sträcka (under 20 m) vara", () => {
    // 20 m brant, sedan flackt: resten är för kort.
    expect(calmFlatContours([line([[-20, 0], [100, 0]])], westSteep, level(3)).features).toEqual([]);
    // Flackt bara mellan x = 0 och 15: ingenting klipps.
    const short = line([[-100, 0], [100, 0]]);
    const out = calmFlatContours([short], x => x >= 0 && x <= 15 ? 0.2 : 8, level(3));
    expect(out.features).toEqual([short]);
    expect(out.features[0]).toBe(short);
    expect(out.formlineMeters).toBe(0);
  });
  it("delar en hjälpkurva som går över ett flackt parti i två bitar", () => {
    const out = calmFlatContours([line([[-100, 0], [200, 0]])], x => x >= 0 && x <= 100 ? 0.2 : 8, level(3));
    expect(out.features).toHaveLength(2);
    expect(out.features.every(feature => lengthOf(feature) >= 90)).toBe(true);
  });
  it("tar bort en sluten hjälpkurva helt på flack mark hel, och klipper en som ligger halvt i sluttning", () => {
    const flatRing = ring(500, 0, 60, "formline");
    const out = calmFlatContours([flatRing], westSteep, level(3));
    expect(out.features).toEqual([]);
    expect(out.rings).toBe(0);
    expect(out.formlineMeters).toBeGreaterThan(370);
    const half = calmFlatContours([ring(0, 0, 60, "formline")], westSteep, level(3));
    expect(half.features).toHaveLength(1);
    expect((half.features[0]!.geometry as { closed: boolean }).closed).toBe(false);
    expect(pointsOf(half.features[0]!).every(point => point[0] < 0)).toBe(true);
    expect(lengthOf(half.features[0]!)).toBeGreaterThan(150);
  });
  it("tar bort en liten ring på flack mark, men inte samma ring i sluttning och inte en stor ring", () => {
    const small = ring(100, 0, 10), steep = ring(-100, 0, 10), large = ring(300, 0, 40), hollow = ring(100, 100, 10, "depression");
    const out = calmFlatContours([small, steep, large, hollow], westSteep, level(3));
    expect(out.features).toEqual([steep, large]);
    expect(out.rings).toBe(2);
    expect(out.formlineMeters).toBe(0);
  });
  it("rör inte stödkurvor, mellankurvor eller vanliga öppna kurvor, och inget där lutningen är okänd", () => {
    const kept = [ring(100, 0, 10, "contour_index"), ring(100, 50, 10, "contour_intermed"), line([[10, 0], [200, 0]], "contour")];
    expect(calmFlatContours(kept, westSteep, level(10)).features).toEqual(kept);
    const unknown = [ring(100, 0, 10), line([[10, 0], [200, 0]])];
    expect(calmFlatContours(unknown, () => undefined, level(10)).features).toEqual(unknown);
  });
  it("tar bort en borttagen sänkas lutningsstreck med den", () => {
    const hollow = ring(100, 0, 10, "depression");
    const tick = depressionTick(hollow)[0]!;
    const other: SourceFeature = { layer: "lutningsstreck", geometry: { kind: "point", at: [400, 400] } };
    const out = calmFlatContours([hollow, tick, other], westSteep, level(3));
    expect(out.features).toEqual([other]);
    expect(out.removed).toEqual([hollow, tick]);
  });
  it("nivå 0 ändrar ingenting, och en högre nivå tar bort minst lika mycket som en lägre", () => {
    // Lutningen växer västerut från 0° vid x = 400 till 6° vid x = -200; ringar i olika storlekar längs vägen.
    const slope = (x: number) => Math.max(0, (400 - x) / 100);
    const features = [line([[-200, 0], [400, 0]]), line([[-200, 50], [400, 50]]),
      ...[5, 12, 18, 25, 35].flatMap((r, i) => [ring(380 - i * 60, 200, r), ring(380 - i * 60, 300, r, "formline")])];
    expect(calmFlatContours(features, slope, level(0))).toEqual({ features, formlineMeters: 0, rings: 0, removed: [], added: [] });
    // Det som blir kvar krymper med nivån (en hjälpkurvering räknas som ring när den är liten, annars i meter).
    const left = (value: number) => { const out = calmFlatContours(features, slope, level(value)); return { out, length: out.features.reduce((sum, feature) => sum + lengthOf(feature), 0) }; };
    let before = left(0);
    for (let value = 1; value <= 10; value += 1) {
      const next = left(value);
      expect(next.length).toBeLessThanOrEqual(before.length);
      expect(next.out.features.length).toBeLessThanOrEqual(before.out.features.length + next.out.added.length);
      expect(next.out.rings + next.out.formlineMeters).toBeGreaterThan(0);
      before = next;
    }
    expect(before.out.rings).toBeGreaterThan(2);
    expect(before.out.formlineMeters).toBeGreaterThan(300);
    expect(left(10).length).toBeLessThan(left(1).length);
  });
  it("ger tillbaka det ursprungliga ur det borttagna", () => {
    const features = [line([[-100, 0], [100, 0]]), ring(100, 50, 10), ring(-100, 50, 10), line([[-100, 90], [100, 90]], "contour")];
    const out = calmFlatContours(features, westSteep, level(3));
    expect(out.features).not.toEqual(features);
    expect(new Set(restoreFlatContours(out.features, out))).toEqual(new Set(features));
  });
});

describe("lugna kurvor på flack mark: medellutningen ur fuktdjupets bild", () => {
  // 60 × 40 celler om 2 m: västra halvan 5° (50 steg), östra 0,4° (4 steg), en okänd cell och en genomskinlig rad längst ner.
  const columns = 60, rows = 40, data = new Uint8Array(columns * rows * 4);
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    data.set([10, 10, column < 30 ? 50 : 4, row === rows - 1 ? 0 : 255], (row * columns + column) * 4);
  }
  data[(5 * columns + 50) * 4 + 2] = 255;
  const grid = slopeGridOf({ width: columns, height: rows, data });
  // Världsfil: 2 m celler, övre vänstra cellens mitt i (1000, 5000).
  const affine = worldFileAffine("2\n0\n0\n-2\n1000\n5000\n")!;
  const slopeAt = flatSlopeFrom(grid, affine);

  it("läser lutningen i blå kanal, med 255 och genomskinligt som okänt", () => {
    expect(grid.steps[0]).toBe(50);
    expect(grid.steps[5 * columns + 50]).toBe(255);
    expect(grid.steps[(rows - 1) * columns + 3]).toBe(255);
    expect(worldFileAffine("inte en världsfil")).toBeUndefined();
  });
  it("ger medellutningen i ett fönster på cirka 40 m, utan de okända cellerna", () => {
    expect(slopeAt(1000 + 2 * 12, 5000 - 2 * 20)).toBeCloseTo(5, 6);
    expect(slopeAt(1000 + 2 * 48, 5000 - 2 * 8)).toBeCloseTo(0.4, 6);
    // Mitt på gränsen (kolumn 30, 21 kolumner i fönstret: 10 branta och 11 flacka).
    expect(slopeAt(1000 + 2 * 30, 5000 - 2 * 20)).toBeCloseTo((10 * 5 + 11 * 0.4) / 21, 6);
  });
  it("svarar inte utanför bilden, och räknar med det som finns vid kanten", () => {
    expect(slopeAt(990, 5000)).toBeUndefined();
    expect(slopeAt(1000 + 2 * 70, 5000)).toBeUndefined();
    expect(slopeAt(1000, 5000)).toBeCloseTo(5, 6);
    expect(slopeAt(1000 + 2 * 59, 5000 - 2 * 39)).toBeCloseTo(0.4, 6);
  });
  it("stämmer med en rak uträkning i varje cell", () => {
    for (const [column, row] of [[0, 0], [25, 3], [33, 17], [50, 5], [59, 38]] as const) {
      let sum = 0, count = 0;
      for (let dc = -10; dc <= 10; dc += 1) for (let dr = -10; dr <= 10; dr += 1) {
        const c = column + dc, r = row + dr;
        if (c < 0 || r < 0 || c >= columns || r >= rows || grid.steps[r * columns + c] === 255) continue;
        sum += grid.steps[r * columns + c]!; count += 1;
      }
      expect(slopeAt(1000 + 2 * column, 5000 - 2 * row)).toBeCloseTo(sum / count * 0.1, 6);
    }
  });
});

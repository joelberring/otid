import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { clearContours, DEFAULT_CLEAR, flatTerrainShare, suggestedClear, formlineLimitsAt, heightFieldFrom, heightGridOf, ringLimitAt, smoothLimitsAt, type HeightField } from "../src/base-map/clear-contours";
import { restoreFlatContours } from "../src/base-map/flat-contours";

type Position = [number, number];
const line = (points: Position[], layer = "contour", closed = false): SourceFeature => ({ layer, geometry: { kind: "line", closed, points } });
const pointsOf = (feature: SourceFeature) => (feature.geometry as { points: readonly (readonly [number, number])[] }).points;
const off = { smooth: 0, formlines: 0, rings: 0 };
/** Ett lutande plan: höjden växer norrut med `slope` (andel); `convex` är höjden över omgivningen överallt. */
const plane = (slope: number, convex = 0): HeightField => ({ heightAt: (_x, y) => y * slope, slopeAt: () => slope, convexAt: () => convex });
/** En kurva österut som vinglar ±`amplitude` m i sidled. */
const wiggle = (amplitude: number, layer = "contour") => line(Array.from({ length: 81 }, (_, i) => [i * 5, amplitude * Math.sin(i * 5 / 8)] as Position), layer);
const turning = (feature: SourceFeature) => pointsOf(feature).reduce((sum, point, i, all) => {
  if (i === 0 || i === all.length - 1) return sum;
  const a = Math.atan2(point[1] - all[i - 1]![1], point[0] - all[i - 1]![0]), b = Math.atan2(all[i + 1]![1] - point[1], all[i + 1]![0] - point[0]);
  return sum + Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
}, 0);

describe("tydligare kurvbild: nivåerna", () => {
  it("0 är av och 5 är förvalet", () => {
    expect(smoothLimitsAt(0)).toBeUndefined(); expect(formlineLimitsAt(0)).toBeUndefined(); expect(ringLimitAt(0)).toBeUndefined();
    expect(DEFAULT_CLEAR).toEqual({ smooth: 5, formlines: 5, rings: 5 });
    expect(smoothLimitsAt(5)).toEqual({ sigma: 15, fullSlope: 0.04, noSlope: 0.12 });
    expect(formlineLimitsAt(5)).toEqual({ minConvex: 0, tight: 5 });
    expect(ringLimitAt(5)).toBe(150); expect(ringLimitAt(10)).toBe(800);
  });
  it("allt av ändrar ingenting", () => {
    const features = [wiggle(4), wiggle(4, "formline")];
    const out = clearContours(features, plane(0.01), off);
    expect(out.features).toEqual(features); expect(out.features[0]).toBe(features[0]); expect(out.removed).toEqual([]);
  });
});

describe("tydligare kurvbild: mjukare kurvor på flack mark", () => {
  it("jämnar ut en vinglig kurva på flack mark men inte i brant", () => {
    const contour = wiggle(4);
    const flat = clearContours([contour], plane(0.01), { ...off, smooth: 5 });
    expect(flat.features).toHaveLength(1);
    expect(turning(flat.features[0]!)).toBeLessThan(turning(contour) * 0.5);
    expect(flat.smoothedMeters).toBeGreaterThan(300);
    expect(pointsOf(flat.features[0]!)[0]).toEqual([0, 0]);
    expect(flat.removed).toEqual([contour]); expect(flat.added).toEqual(flat.features);
    expect(restoreFlatContours(flat.features, flat)).toEqual([contour]);
    const steep = clearContours([contour], plane(0.3), { ...off, smooth: 5 });
    expect(steep.features[0]).toBe(contour); expect(steep.smoothedMeters).toBe(0);
  });
  it("höjdgränsen håller emot: 1,25 m för höjdkurvor och hälften för hjälpkurvor", () => {
    // Lutningen ges som 1 % (flackt) så att bara höjdgränsen håller emot; höjden växer 0,5 m per meter norrut.
    const tilted: HeightField = { heightAt: (_x, y) => y * 0.5, slopeAt: () => 0.01, convexAt: () => 0 };
    const level: HeightField = { heightAt: () => 0, slopeAt: () => 0.01, convexAt: () => 0 };
    const swing = (field: HeightField, layer: string) => Math.max(...pointsOf(clearContours([wiggle(6, layer)], field, { ...off, smooth: 10 }).features[0]!).slice(20, -20).map(point => Math.abs(point[1])));
    expect(swing(level, "contour")).toBeLessThan(1);
    // Högst 1,25 m i höjd är 2,5 m i sidled här: kurvan får behålla minst 3,5 av sina 6 m.
    expect(swing(tilted, "contour")).toBeGreaterThan(3.4);
    expect(swing(tilted, "formline")).toBeGreaterThan(swing(tilted, "contour") + 0.5);
  });
  it("en sluten kurva förblir sluten utan dubbel slutpunkt", () => {
    const ring = line(Array.from({ length: 72 }, (_, i) => { const r = 80 + 6 * Math.sin(i * 1.3); return [r * Math.cos(i * Math.PI / 36), r * Math.sin(i * Math.PI / 36)] as Position; }), "contour", true);
    const out = clearContours([ring], { heightAt: () => 10, slopeAt: () => 0, convexAt: () => 0 }, { ...off, smooth: 5 }).features[0]!;
    const points = pointsOf(out);
    expect((out.geometry as { closed: boolean }).closed).toBe(true);
    expect(Math.hypot(points[0]![0] - points[points.length - 1]![0], points[0]![1] - points[points.length - 1]![1])).toBeGreaterThan(0.5);
  });
});

describe("tydligare kurvbild: färre hjälpkurvor", () => {
  const formline = line([[0, 0], [200, 0]], "formline");
  it("behåller hjälpkurvan på en höjd och tar bort den i en sänka", () => {
    expect(clearContours([formline], plane(0.1, 1.5), { ...off, formlines: 5 }).features[0]).toBe(formline);
    const out = clearContours([formline], plane(0.1, -1), { ...off, formlines: 5 });
    expect(out.features).toEqual([]); expect(out.formlineMeters).toBe(200); expect(out.removed).toEqual([formline]);
  });
  it("klipper bara biten där marken inte är en höjd", () => {
    const field: HeightField = { heightAt: () => 0, slopeAt: () => 0.1, convexAt: x => x < 100 ? 1 : -1 };
    const out = clearContours([formline], field, { ...off, formlines: 5 });
    expect(out.features).toHaveLength(1);
    const xs = pointsOf(out.features[0]!).map(point => point[0]);
    expect(xs[0]).toBe(0); expect(xs[xs.length - 1]).toBeGreaterThan(90); expect(xs[xs.length - 1]).toBeLessThan(100);
    expect(out.formlineMeters).toBeGreaterThan(95);
  });
  it("tar bort hjälpkurvan där en höjdkurva ligger tätt intill, från nivå 5", () => {
    const contour = line([[0, 3], [200, 3]]);
    expect(clearContours([contour, formline], plane(0.3, 2), { ...off, formlines: 5 }).features).toEqual([contour]);
    expect(clearContours([contour, formline], plane(0.3, 2), { ...off, formlines: 1 }).features).toEqual([contour, formline]);
    const far = line([[0, 9], [200, 9]]);
    expect(clearContours([far, formline], plane(0.3, 2), { ...off, formlines: 5 }).features).toEqual([far, formline]);
  });
  it("utan höjd rörs ingenting", () => {
    const none: HeightField = { heightAt: () => undefined, slopeAt: () => undefined, convexAt: () => undefined };
    expect(clearContours([formline], none, DEFAULT_CLEAR).removed).toEqual([]);
    expect(clearContours([wiggle(4)], none, DEFAULT_CLEAR).removed).toEqual([]);
  });
});

describe("tydligare kurvbild: små ringar av hjälpkurva", () => {
  const ring = (r: number, layer = "formline") => line(Array.from({ length: 24 }, (_, i) => [r * Math.cos(i * Math.PI / 12), r * Math.sin(i * Math.PI / 12)] as Position), layer, true);
  it("tar bort ringar under gränsen, men inte större och inte höjdkurvor", () => {
    const small = ring(5), large = ring(12), contour = ring(5, "contour");
    const out = clearContours([small, large, contour], plane(0.3, 2), { ...off, rings: 5 });
    expect(out.features).toEqual([large, contour]); expect(out.rings).toBe(1);
  });
});

describe("tydligare kurvbild: höjden ur hojd.png", () => {
  it("läser cm + 10 000 som 24 bitar och räknar lutning och höjd över omgivningen", () => {
    // 200 × 200 celler om 1 m: höjden stiger 0,1 m per meter österut.
    const size = 200, data = new Uint8ClampedArray(size * size * 4);
    for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) {
      const value = Math.round(column * 0.1 * 100) + 10_000, p = (row * size + column) * 4;
      data[p] = value >> 16; data[p + 1] = (value >> 8) & 255; data[p + 2] = value & 255; data[p + 3] = column === 0 ? 0 : 255;
    }
    const grid = heightGridOf({ width: size, height: size, data });
    expect(grid.meters[5]).toBeCloseTo(0.5, 5); expect(grid.meters[0]).toBeNaN();
    const field = heightFieldFrom([{ grid, affine: [1, 0, 1000, 0, -1, 5000] }]);
    expect(field.heightAt(1100, 4900)).toBeCloseTo(10, 5);
    expect(field.slopeAt(1100, 4900)).toBeCloseTo(0.1, 5);
    expect(field.convexAt(1100, 4900)).toBeCloseTo(0, 1);
    expect(field.heightAt(900, 4900)).toBeUndefined(); expect(field.heightAt(1000, 4900)).toBeUndefined();
    // Nära kanten finns för lite av ringen.
    expect(field.convexAt(1010, 4990)).toBeUndefined();
  });
});

describe("tydligare kurvbild: förvalen efter terrängen", () => {
  const contours = (count: number) => Array.from({ length: count }, (_, i) => line([[0, i * 50], [2000, i * 50]]));
  /** Marken lutar `steep` norr om y = `border` och 2 % söder om. */
  const split = (border: number): HeightField => ({ heightAt: () => 0, slopeAt: (_x, y) => y >= border ? 0.3 : 0.02, convexAt: () => 0 });
  it("mäter andelen av höjdkurvornas längd på mark under 12 % lutning", () => {
    expect(flatTerrainShare(contours(10), split(250))).toBeCloseTo(0.5, 2);
    expect(flatTerrainShare(contours(10), plane(0.3))).toBe(0);
    expect(flatTerrainShare([line([[0, 0], [100, 0]], "formline")], plane(0.01))).toBeUndefined();
  });
  it("behåller förvalen i kuperad terräng och tar bort mindre i flack", () => {
    expect(suggestedClear(contours(10), plane(0.3))).toEqual(DEFAULT_CLEAR);
    expect(suggestedClear(contours(10), split(100))).toEqual(DEFAULT_CLEAR);
    expect(suggestedClear(contours(10), plane(0.02))).toEqual({ smooth: 4, formlines: 3, rings: 1 });
    // 30 % flackt: hjälpkurvorna en nivå ner, ringarna och utjämningen som förvalet.
    expect(suggestedClear(contours(10), split(150))).toEqual({ smooth: 5, formlines: 4, rings: 5 });
    expect(suggestedClear([], plane(0.02))).toEqual(DEFAULT_CLEAR);
  });
});

import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { clearContours, type HeightField } from "../src/base-map/clear-contours";
import { depressionRing, ringTick, smallDepressionPoints, tickDepressions } from "../src/base-map/depressions";
import { mergeBaseMap } from "../src/base-map/merge";

type Position = [number, number];
const circle = (cx: number, cy: number, r: number, layer: string, clockwise = false): SourceFeature => ({ layer,
  geometry: { kind: "line", closed: true, points: Array.from({ length: 24 }, (_, i) => { const a = (clockwise ? -i : i) * Math.PI / 12; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Position; }) } });
/** Karttapullautins lilla grop: en båge med åtta punkter, 12 m bred och 7 m hög. */
const arc = (x: number, y: number): SourceFeature => ({ layer: "small_depression", elevation: 730,
  geometry: { kind: "line", closed: false, points: [[x - 6, y + 3.5], [x - 5, y - 1], [x - 3, y - 3], [x - 1, y - 3.5], [x + 1, y - 3.5], [x + 3, y - 3], [x + 5, y - 1], [x + 6, y + 3.5]] } });
/** En skål (sänka) eller kupol (höjd) kring origo: höjden ändras `rise` m per meter från mitten upp till 30 m. */
const bowl = (rise: number): Pick<HeightField, "heightAt"> => ({ heightAt: (x, y) => 100 + rise * Math.min(30, Math.hypot(x, y)) });
const at = (feature: SourceFeature) => feature.geometry as { readonly at: readonly [number, number]; readonly toward?: readonly [number, number] };
const pointsOf = (feature: SourceFeature) => (feature.geometry as { readonly points: readonly (readonly [number, number])[] }).points;

describe("Karttapullautins små gropar (small_depression)", () => {
  it("bågen blir en gropsymbol i bågens mitt", () => {
    const contour = circle(0, 0, 100, "contour");
    const out = smallDepressionPoints([contour, arc(200, 300)]);
    expect(out[0]).toBe(contour);
    expect(out[1]).toEqual({ layer: "udepression", geometry: { kind: "point", at: [200, 300] } });
  });
  it("ingen dubblett där en grop redan ligger, i samma fil eller i en annan", () => {
    const pit: SourceFeature = { layer: "udepression", geometry: { kind: "point", at: [201, 301] } };
    expect(smallDepressionPoints([pit, arc(200, 300), arc(300, 300), arc(301, 300)]).map(feature => at(feature).at)).toEqual([[201, 301], [300, 300]]);
    expect(smallDepressionPoints([arc(200, 300)], [pit])).toEqual([]);
  });
  it("grundkartan får gropsymbolen i stället för en bit höjdkurva", () => {
    const merged = mergeBaseMap([{ name: "kurvor.dxf", data: { skipped: 0, features: [circle(0, 0, 100, "contour"), arc(200, 300)] } }], undefined, 15_000);
    expect(merged.features.map(feature => feature.layer).sort()).toEqual(["contour", "udepression"]);
  });
});

describe("sänka eller höjd ur markens höjd", () => {
  it("marken innanför lägre än utanför är en sänka, åt vilket håll ringen än är ritad", () => {
    expect(depressionRing(pointsOf(circle(0, 0, 12, "formline")), bowl(0.1))).toBe(true);
    expect(depressionRing(pointsOf(circle(0, 0, 12, "formline", true)), bowl(0.1))).toBe(true);
    expect(depressionRing(pointsOf(circle(0, 0, 12, "formline")), bowl(-0.1))).toBe(false);
  });
  it("för liten skillnad eller ingen höjd ger inget svar", () => {
    const points = pointsOf(circle(0, 0, 12, "formline"));
    expect(depressionRing(points, bowl(0.01))).toBeUndefined();
    expect(depressionRing(points, { heightAt: () => undefined })).toBeUndefined();
  });
  it("en smal ring provas närmare kanten, så att provet inte hamnar på andra sidan", () => {
    const narrow: Position[] = [[0, 0], [40, 0], [40, 3], [0, 3]];
    // En ränna längs x-axeln: lägst i mitten (y = 1,5).
    expect(depressionRing(narrow, { heightAt: (_x, y) => 100 + Math.abs(y - 1.5) })).toBe(true);
  });
});

describe("lutningsstreck efter höjden", () => {
  it("en hjälpkurvering runt en sänka får ett streck som pekar inåt; en ring runt en höjd får inget", () => {
    const pit = circle(0, 0, 12, "formline"), hill = circle(0, 0, 20, "contour");
    const down = tickDepressions([pit], bowl(0.1));
    expect(down.ticks).toBe(1); expect(down.byHeight).toBe(1);
    const tick = down.features.find(feature => feature.layer === "lutningsstreck")!;
    expect(Math.hypot(...at(tick).at)).toBeGreaterThan(11); expect(Math.hypot(...at(tick).at)).toBeLessThan(12.1);
    expect(Math.hypot(...at(tick).toward!)).toBeLessThan(Math.hypot(...at(tick).at) - 4);
    expect(tickDepressions([hill], bowl(-0.1)).ticks).toBe(0);
  });
  it("utan höjd avgör lagrets namn, och höjden går före namnet", () => {
    const named = circle(0, 0, 12, "depression");
    expect(tickDepressions([named]).ticks).toBe(1);
    expect(tickDepressions([named], { heightAt: () => undefined }).ticks).toBe(1);
    expect(tickDepressions([named], bowl(-0.1)).ticks).toBe(0);
    expect(tickDepressions([circle(0, 0, 12, "formline")]).ticks).toBe(0);
  });
  it("gamla streck tas bort och räknas om, öppna linjer och andra lager rörs inte", () => {
    const stale: SourceFeature = { layer: "lutningsstreck", geometry: { kind: "point", at: [500, 500], toward: [0, 0] } };
    const open: SourceFeature = { layer: "formline", geometry: { kind: "line", closed: false, points: [[0, 0], [10, 0], [20, 5], [30, 5]] } };
    const stone: SourceFeature = { layer: "sten", geometry: { kind: "point", at: [1, 1] } };
    const out = tickDepressions([stale, open, stone, circle(0, 0, 12, "formline")], bowl(0.1));
    expect(out.features).not.toContain(stale);
    expect(out.features.filter(feature => feature.layer === "lutningsstreck")).toHaveLength(1);
    expect(out.features).toContain(open); expect(out.features).toContain(stone);
  });
  it("strecket sitter mitt på den längsta sträckan och pekar vinkelrätt inåt även på en ring som inte är konvex", () => {
    // Ett L: mitten av ringens punkter ligger utanför den längsta sidans inåtriktning om man siktar på mitten.
    const [tick] = ringTick([[0, 0], [60, 0], [60, 10], [10, 10], [10, 40], [0, 40]]);
    expect(at(tick!).at).toEqual([30, 0]); expect(at(tick!).toward).toEqual([30, 5]);
  });
});

describe("tydligare kurvbild: en hjälpkurvering runt en sänka klipps inte", () => {
  it("samma ring klipps runt en höjd i en svacka men står kvar runt en sänka", () => {
    const ring = circle(0, 0, 14, "formline"), settings = { smooth: 0, formlines: 5, rings: 0 };
    // Marken ligger 2 m under omgivningen överallt (hjälpkurvor där tas annars bort).
    const field = (rise: number): HeightField => ({ ...bowl(rise), slopeAt: () => 0.2, convexAt: () => -2 });
    expect(clearContours([ring], field(-0.1), settings).features).toEqual([]);
    const kept = clearContours([ring], field(0.1), settings);
    expect(kept.features).toEqual([ring]); expect(kept.formlineMeters).toBe(0);
  });
});

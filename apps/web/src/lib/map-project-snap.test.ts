import { describe, expect, it } from "vitest";
import type { MapObject, MapSymbol, Point } from "@o-tid/map-file";
import { buildSnapIndex, nearestAnchor, objectExtra, snapAt, snapReachMm } from "./map-project-snap";

const line = (symbol: string, ...points: Point[]): MapObject =>
  ({ kind: "line", symbol, path: points.map((at, index) => ({ type: index === 0 ? "M" as const : "L" as const, x: at.x, y: at.y })) });
const symbols = (hidden: string[] = []) => new Map<string, MapSymbol>(["a", "b", "c", ...hidden].map(id =>
  [id, { id, kind: "LINE", hidden: hidden.includes(id), code: { text: "505", main: 505, sub: 0 }, name: id, strokes: [] } as unknown as MapSymbol]));

describe("Fäst (K8b V3)", () => {
  // Ett kryss: a går vågrätt 0–20, b lodrätt 10,−10–10,10; c slutar vid 30,0.
  const objects = [line("a", { x: 0, y: 0 }, { x: 20, y: 0 }), line("b", { x: 10, y: -10 }, { x: 10, y: 10 }), line("c", { x: 30, y: 0 }, { x: 40, y: 5 })];
  const index = buildSnapIndex(objects, ["A", "B", "C"], symbols());

  it("en punkt går före en skärning och en kant", () => {
    const hit = snapAt(index, { point: { x: 19.2, y: 0.3 }, reachMm: 1 });
    expect(hit?.kind).toBe("vertex");
    expect(hit?.at).toEqual({ x: 20, y: 0 });
    expect(hit?.target).toMatchObject({ key: "A", part: 0, index: 1 });
  });

  it("skärningen mellan två linjer går före kanten", () => {
    const hit = snapAt(index, { point: { x: 10.4, y: 0.5 }, reachMm: 1 });
    expect(hit?.kind).toBe("intersection");
    expect(hit?.at.x).toBeCloseTo(10); expect(hit?.at.y).toBeCloseTo(0);
    expect(new Set([hit?.target.key, hit?.other?.key])).toEqual(new Set(["A", "B"]));
  });

  it("annars närmaste punkt på linjen, med sträckan", () => {
    const hit = snapAt(index, { point: { x: 5, y: 0.6 }, reachMm: 1 });
    expect(hit).toMatchObject({ kind: "edge", at: { x: 5, y: 0 }, target: { key: "A", from: { x: 0, y: 0 }, to: { x: 20, y: 0 } } });
    expect(hit?.distance).toBeCloseTo(0.6);
    expect(snapAt(index, { point: { x: 5, y: 2 }, reachMm: 1 })).toBeUndefined();
  });

  it("det egna objektet utesluts, men utkastets tidigare punkter fäster", () => {
    expect(snapAt(index, { point: { x: 19.5, y: 0 }, reachMm: 1, exclude: new Set(["A"]) })).toBeUndefined();
    const own = snapAt(index, { point: { x: 50.3, y: 0 }, reachMm: 1, extra: { points: [{ x: 50, y: 0 }], segments: [] } });
    expect(own).toMatchObject({ kind: "vertex", at: { x: 50, y: 0 }, target: { key: undefined } });
    // Utkastets sträcka skär linjen b.
    const crossing = snapAt(index, { point: { x: 10.3, y: 5.2 }, reachMm: 1, exclude: new Set(["A"]),
      extra: { points: [], segments: [[{ x: 0, y: 5 }, { x: 20, y: 5 }]] } });
    expect(crossing?.kind).toBe("intersection");
    expect(crossing?.at.y).toBeCloseTo(5);
  });

  it("släckta symboler och symboler dolda i filen fäster inte; låsta gör det", () => {
    expect(snapAt(index, { point: { x: 10.2, y: 9.8 }, reachMm: 1, hidden: new Set(["b"]) })).toBeUndefined();
    const fileHidden = buildSnapIndex([line("d", { x: 0, y: 0 }, { x: 1, y: 0 })], ["D"], symbols(["d"]));
    expect(snapAt(fileHidden, { point: { x: 0, y: 0 }, reachMm: 1 })).toBeUndefined();
  });

  it("kurvornas ankarpunkter, inte de utplattade punkterna, är brytpunkter", () => {
    const curve: MapObject = { kind: "line", symbol: "a", path: [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 3, y1: 5, x2: 7, y2: 5, x: 10, y: 0 }] };
    const curveIndex = buildSnapIndex([curve], ["K"], symbols());
    const middle = snapAt(curveIndex, { point: { x: 5, y: 3.9 }, reachMm: 0.5 });
    expect(middle?.kind).toBe("edge");
    expect(snapAt(curveIndex, { point: { x: 9.8, y: 0.2 }, reachMm: 0.5 })?.kind).toBe("vertex");
  });

  it("räckvidden räknas i skärmens pixlar: 10 med mus, 22 med finger eller penna", () => {
    expect(snapReachMm("mouse", 4)).toBeCloseTo(2.5);
    expect(snapReachMm("touch", 4)).toBeCloseTo(5.5);
    expect(snapReachMm("pen", 2)).toBeCloseTo(11);
    // Samma 1,5 mm från linjen: inutzoomat (8 px/mm, 1,25 mm) fäster inte, utzoomat (4 px/mm, 2,5 mm) fäster.
    expect(snapAt(index, { point: { x: 5, y: 1.5 }, reachMm: snapReachMm("mouse", 8) })).toBeUndefined();
    expect(snapAt(index, { point: { x: 5, y: 1.5 }, reachMm: snapReachMm("mouse", 4) })?.kind).toBe("edge");
  });

  it("objektets punkter utan den som dras, och ankaret närmast", () => {
    const object = line("a", { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 });
    const extra = objectExtra(object, { x: 10, y: 10 });
    expect(extra.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(extra.segments).toEqual([[{ x: 0, y: 0 }, { x: 10, y: 0 }]]);
    expect(nearestAnchor(object, { x: 9, y: 8 })).toEqual({ x: 10, y: 10 });
  });

  it("går fort på en stor karta (~50 000 sträckor)", () => {
    // Ett rutnät av 250 + 250 linjer med 100 sträckor var över 500 × 500 mm, och små hus (punkter) däremellan.
    const big: MapObject[] = [];
    for (let i = 0; i < 250; i += 1) {
      big.push(line("a", ...Array.from({ length: 101 }, (_, j) => ({ x: j * 5, y: i * 2 + 0.3 }))));
      big.push(line("b", ...Array.from({ length: 101 }, (_, j) => ({ x: i * 2 + 0.7, y: j * 5 }))));
    }
    const built = performance.now();
    const bigIndex = buildSnapIndex(big, big.map((_, i) => `o${i}`), symbols());
    const buildMs = performance.now() - built;
    expect(bigIndex.segments.length / 4).toBe(50_000);
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const queries = Array.from({ length: 20_000 }, () => ({ x: random() * 500, y: random() * 500 }));
    for (const point of queries.slice(0, 2000)) snapAt(bigIndex, { point, reachMm: 2.5 });
    const started = performance.now();
    let found = 0;
    for (const point of queries) if (snapAt(bigIndex, { point, reachMm: 2.5, hidden: new Set(["c"]) })) found += 1;
    const perQuery = (performance.now() - started) / queries.length;
    console.info(`Fäst: index ${buildMs.toFixed(0)} ms, ${(perQuery * 1000).toFixed(1)} µs per fråga`);
    expect(found).toBeGreaterThan(queries.length * 0.9);
    expect(perQuery).toBeLessThan(1);
  });
});

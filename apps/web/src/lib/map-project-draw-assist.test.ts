import { describe, expect, it } from "vitest";
import type { MapObject, MapSymbol, Point } from "@o-tid/map-file";
import { angleReference, followEdge, lockAngle, snapOnRay } from "./map-project-draw-assist";
import { buildSnapIndex, snapAt } from "./map-project-snap";

const path = (points: Point[]) => points.map((at, index) => ({ type: index === 0 ? "M" as const : "L" as const, x: at.x, y: at.y }));
const line = (...points: Point[]): MapObject => ({ kind: "line", symbol: "a", path: path(points) });
const square = (x: number, y: number, size: number): MapObject =>
  ({ kind: "area", symbol: "a", angle: 0, rings: [path([{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }])] });
const symbols = new Map<string, MapSymbol>([["a", { id: "a", kind: "LINE", hidden: false, code: { text: "501", main: 501, sub: 0 }, name: "a" } as unknown as MapSymbol]]);
const close = (a: Point | undefined, b: Point) => { expect(a?.x).toBeCloseTo(b.x, 6); expect(a?.y).toBeCloseTo(b.y, 6); };

describe("Följ kant (K8b V5)", () => {
  it("en öppen linje: från fästpunkten till pekarens punkt på linjen, med brytpunkterna emellan (åt båda håll)", () => {
    const index = buildSnapIndex([line({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 })], ["L"], symbols);
    const start = snapAt(index, { point: { x: 4, y: 0.2 }, reachMm: 1 })!;
    expect(start.kind).toBe("edge");
    const ahead = followEdge(index, start, { x: 16, y: 11 })!;
    expect(ahead.points).toHaveLength(3);
    close(ahead.points[0], { x: 10, y: 0 }); close(ahead.points[1], { x: 10, y: 10 }); close(ahead.points[2], { x: 16, y: 10 });
    expect(ahead.hit).toMatchObject({ kind: "edge", target: { key: "L", part: 0 } });
    // Tillbaka mot början: inga brytpunkter emellan.
    const back = followEdge(index, start, { x: 1, y: -2 })!;
    expect(back.points).toHaveLength(1);
    close(back.points[0], { x: 1, y: 0 });
  });

  it("en sluten ring går den kortare vägen runt", () => {
    // Ytan 0–10 × 0–10 (filen upprepar inte första punkten; ringen sluts ändå).
    const index = buildSnapIndex([square(0, 0, 10)], ["Y"], symbols);
    const start = snapAt(index, { point: { x: 8, y: 0.1 }, reachMm: 1 })!;
    // Till vänstra sidan nära botten: kortare bakåt via (0,0) än framåt runt tre hörn.
    const short = followEdge(index, start, { x: -0.5, y: 2 })!;
    expect(short.points).toHaveLength(2);
    close(short.points[0], { x: 0, y: 0 }); close(short.points[1], { x: 0, y: 2 });
    // Till högra sidan nära toppen: framåt via (10,0).
    const other = followEdge(index, start, { x: 10.4, y: 8 })!;
    expect(other.points).toHaveLength(2);
    close(other.points[0], { x: 10, y: 0 }); close(other.points[1], { x: 10, y: 8 });
    // Från en punkt (hörnet) runt till motsatt hörns grannsida.
    const corner = snapAt(index, { point: { x: 0.1, y: 0.1 }, reachMm: 1 })!;
    expect(corner.kind).toBe("vertex");
    const round = followEdge(index, corner, { x: 6, y: 10.3 })!;
    expect(round.points).toHaveLength(2);
    close(round.points[0], { x: 0, y: 10 }); close(round.points[1], { x: 6, y: 10 });
  });

  it("kurvor följs tätt utplattade, med punkterna på kurvan", () => {
    const curve: MapObject = { kind: "line", symbol: "a", path: [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 0, y1: 10, x2: 20, y2: 10, x: 20, y: 0 }] };
    const index = buildSnapIndex([curve], ["K"], symbols);
    const start = snapAt(index, { point: { x: 0, y: 0.3 }, reachMm: 1 })!;
    const followed = followEdge(index, start, { x: 20.2, y: 0.4 })!;
    expect(followed.points.length).toBeGreaterThan(8);
    // Varje punkt ligger på kurvan: x(t), y(t) för någon t.
    const bezier = (t: number) => ({ x: 3 * (1 - t) * t * t * 20 + t * t * t * 20, y: 3 * (1 - t) * (1 - t) * t * 10 + 3 * (1 - t) * t * t * 10 });
    for (const point of followed.points) {
      let best = Infinity;
      for (let t = 0; t <= 1; t += 0.0005) { const at = bezier(t); best = Math.min(best, Math.hypot(at.x - point.x, at.y - point.y)); }
      expect(best).toBeLessThan(0.02);
    }
    expect(followed.points.at(-1)!.x).toBeCloseTo(20, 1);
  });

  it("följer inte utkastets egna punkter eller ett fäst som saknar linje", () => {
    const index = buildSnapIndex([line({ x: 0, y: 0 }, { x: 10, y: 0 })], ["L"], symbols);
    const own = snapAt(index, { point: { x: 30, y: 0 }, reachMm: 1, extra: { points: [{ x: 30, y: 0 }], segments: [] } })!;
    expect(followEdge(index, own, { x: 5, y: 0 })).toBeUndefined();
  });
});

describe("Vinkellås (K8b V5)", () => {
  it("relativt förra sträckan i steg om 45°", () => {
    // Förra sträckan går snett uppåt höger (30°).
    const a = { x: 0, y: 0 }, b = { x: Math.cos(Math.PI / 6) * 10, y: Math.sin(Math.PI / 6) * 10 };
    const reference = angleReference([a, b], undefined, undefined);
    expect(reference.kind).toBe("segment");
    // Pekaren ungefär vinkelrätt: låses till exakt 120°.
    const locked = lockAngle(b, { x: b.x - 4, y: b.y + 7 }, reference);
    const angle = Math.atan2(locked.at.y - b.y, locked.at.x - b.x) * 180 / Math.PI;
    expect(angle).toBeCloseTo(120, 6);
    // 45° mot förra sträckan = 75°.
    const diagonal = lockAngle(b, { x: b.x + 1.5, y: b.y + 6 }, reference);
    expect(Math.atan2(diagonal.at.y - b.y, diagonal.at.x - b.x) * 180 / Math.PI).toBeCloseTo(75, 6);
  });

  it("första sträckan från en fäst kant: vinkelrätt eller parallellt mot kanten", () => {
    const index = buildSnapIndex([line({ x: 0, y: 0 }, { x: 10, y: 10 })], ["L"], symbols);
    const start = snapAt(index, { point: { x: 5, y: 5.2 }, reachMm: 1 })!;
    const reference = angleReference([start.at], start, index);
    expect(reference).toMatchObject({ kind: "edge" });
    expect(reference.step * 180 / Math.PI).toBeCloseTo(90);
    // Nästan rakt upp (45° från kanten) väljer vinkelrätt (135°), inte 45°-steg.
    const up = lockAngle(start.at, { x: start.at.x - 2, y: start.at.y + 6 }, reference);
    expect(Math.atan2(up.at.y - start.at.y, up.at.x - start.at.x) * 180 / Math.PI).toBeCloseTo(135, 6);
    // Också från en punkt på linjen (ändpunkten): kanten där.
    const end = snapAt(index, { point: { x: 10.2, y: 10 }, reachMm: 1 })!;
    expect(end.kind).toBe("vertex");
    expect(angleReference([end.at], end, index).kind).toBe("edge");
  });

  it("annars mot kartans norr i steg om 45°", () => {
    const reference = angleReference([{ x: 0, y: 0 }], undefined, undefined);
    expect(reference.kind).toBe("north");
    const locked = lockAngle({ x: 0, y: 0 }, { x: 1, y: 9 }, reference);
    close(locked.at, { x: 0, y: 9 });
    const ne = lockAngle({ x: 0, y: 0 }, { x: 6, y: 5 }, reference);
    expect(ne.at.x).toBeCloseTo(ne.at.y, 6);
  });

  it("med fäst: skärningen mellan den låsta strålen och närmaste linje, annars längden fri", () => {
    // En lodrät linje vid x = 10; låst rakt österut från origo.
    const index = buildSnapIndex([line({ x: 10, y: -5 }, { x: 10, y: 5 })], ["L"], symbols);
    const reference = angleReference([{ x: 0, y: 0 }], undefined, undefined);
    const locked = lockAngle({ x: 0, y: 0 }, { x: 9.4, y: 0.6 }, reference);
    close(locked.at, { x: 9.4, y: 0 });
    const hit = snapOnRay(index, { origin: { x: 0, y: 0 }, dir: locked.dir, near: locked.at, reachMm: 1 });
    expect(hit).toMatchObject({ kind: "edge", target: { key: "L" } });
    close(hit?.at, { x: 10, y: 0 });
    // Utanför räckvidden: inget fäst (punkten blir den låsta).
    expect(snapOnRay(index, { origin: { x: 0, y: 0 }, dir: locked.dir, near: { x: 6, y: 0 }, reachMm: 1 })).toBeUndefined();
    // Släckta symboler fäster inte.
    expect(snapOnRay(index, { origin: { x: 0, y: 0 }, dir: locked.dir, near: locked.at, reachMm: 1, hidden: new Set(["a"]) })).toBeUndefined();
  });
});

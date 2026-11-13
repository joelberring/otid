import { describe, expect, it } from "vitest";
import { maskRings } from "../../../scripts/geo-moisture";
import {
  boundingRectangle, DEFAULT_PAVED_GENERALIZE, distanceToRing, generalizePavedRing, generalizePavedRingDetailed, mainDirection, pavedRingProblem, selfIntersects, signedArea
} from "../../../scripts/geo-paved-generalize";

type Point = [number, number];
const CELL = 2;
/** Rasterringen (trappsteg i 2 m-celler) för ytan `inside`, som geo-arbetaren ger den: cellens mitt avgör. */
function rasterRing(inside: (x: number, y: number) => boolean, size = 140): Point[] {
  const mask = new Uint8Array(size * size);
  for (let x = 0; x < size; x += 1) for (let y = 0; y < size; y += 1) if (inside((x + 0.5) * CELL, (y + 0.5) * CELL)) mask[x * size + y] = 1;
  const rings = maskRings(mask, { minX: CELL / 2, minY: CELL / 2, cell: CELL, width: size, height: size, z: new Float64Array(0) });
  expect(rings).toHaveLength(1);
  return rings[0]!;
}
const rotate = (angle: number, cx: number, cy: number) => {
  const cos = Math.cos(angle * Math.PI / 180), sin = Math.sin(angle * Math.PI / 180);
  return { to: ([u, v]: Point): Point => [cx + u * cos - v * sin, cy + u * sin + v * cos], from: (x: number, y: number): Point => [(x - cx) * cos + (y - cy) * sin, -(x - cx) * sin + (y - cy) * cos] };
};
const nearest = (point: Point, ring: readonly Point[]) => Math.min(...ring.map(other => Math.hypot(other[0] - point[0], other[1] - point[1])));
/** Hörnens vinklar i grader. */
const angles = (ring: readonly Point[]) => ring.map((b, i) => {
  const a = ring[(i + ring.length - 1) % ring.length]!, c = ring[(i + 1) % ring.length]!;
  return Math.abs(Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]))) * 180 / Math.PI;
});

describe("de belagda ytornas generalisering (ägaren 2026-11-13)", () => {
  it("en trappstegsformad rektangel på 30 × 60 m, vriden 20°, blir fyra hörn nära de sanna", () => {
    const turn = rotate(20, 140, 140);
    const raw = rasterRing((x, y) => { const [u, v] = turn.from(x, y); return Math.abs(u) <= 30 && Math.abs(v) <= 15; });
    expect(raw.length).toBeGreaterThan(40);
    const ring = generalizePavedRing(raw);
    expect(ring).toHaveLength(4);
    const truth = ([[-30, -15], [30, -15], [30, 15], [-30, 15]] as Point[]).map(turn.to);
    for (const corner of truth) expect(nearest(corner, ring)).toBeLessThan(1.5);
    for (const angle of angles(ring)) expect(angle).toBeCloseTo(90, 1);
    expect(Math.abs(signedArea(ring))).toBeCloseTo(Math.abs(signedArea(raw)), 0);
    // Ett hål (medurs) generaliseras på samma sätt och förblir medurs.
    const hole = generalizePavedRing([...raw].reverse());
    expect(hole).toHaveLength(4);
    expect(signedArea(hole)).toBeLessThan(0);
  });

  it("en L-formad yta behåller sex hörn med räta vinklar", () => {
    const turn = rotate(20, 140, 140);
    // 80 × 80 m utan kvadranten uppe till höger: tre fjärdedelar av sin omskrivna rektangel.
    const raw = rasterRing((x, y) => { const [u, v] = turn.from(x, y); return Math.abs(u) <= 40 && Math.abs(v) <= 40 && !(u > 0 && v > 0); });
    const ring = generalizePavedRing(raw);
    expect(ring).toHaveLength(6);
    for (const angle of angles(ring)) expect(angle).toBeCloseTo(90, 1);
    const truth = ([[-40, -40], [40, -40], [40, 0], [0, 0], [0, 40], [-40, 40]] as Point[]).map(turn.to);
    for (const corner of truth) expect(nearest(corner, ring)).toBeLessThan(2);
    expect(mainDirection(ring, 12).share).toBeCloseTo(1, 5);
    expect(mainDirection(ring, 12).angle * 180 / Math.PI).toBeCloseTo(20, 0);
  });

  it("en svängd väg behåller sin form och blir inte en rektangel", () => {
    // En båge: 8 m bred, radie 80 m, ett kvarts varv.
    const raw = rasterRing((x, y) => { const r = Math.hypot(x - 20, y - 20), a = Math.atan2(y - 20, x - 20); return Math.abs(r - 80) <= 4 && a >= 0.05 && a <= Math.PI / 2 - 0.05; });
    const detailed = generalizePavedRingDetailed(raw);
    expect(detailed.problem).toBeUndefined();
    const ring = detailed.ring;
    expect(ring.length).toBeGreaterThan(6);
    expect(ring.length).toBeLessThan(raw.length / 3);
    // Ingen punkt flyttas mer än 2 m: varken de nya hörnen från rasterkanten eller rasterkanten från den nya ringen.
    for (const point of ring) expect(distanceToRing(point, raw)).toBeLessThan(2);
    for (const point of raw) expect(distanceToRing(point, ring)).toBeLessThan(2);
    expect(mainDirection(ring, 12).share).toBeLessThan(0.7);
    expect(Math.abs(signedArea(ring)) / Math.abs(signedArea(raw))).toBeGreaterThan(0.9);
  });

  it("en rak gata som svänger svagt vrids inte till huvudriktningen", () => {
    // 200 m gata, 8 m bred, i två raka delar med 8° mellan sig: båda ligger inom 12° men skulle flyttas för långt.
    const raw = rasterRing((x, y) => { const u = x - 20, v = y - 60 - (u > 100 ? (u - 100) * Math.tan(8 * Math.PI / 180) : 0); return u >= 0 && u <= 200 && Math.abs(v) <= 4; });
    const ring = generalizePavedRing(raw);
    for (const point of raw) expect(distanceToRing(point, ring)).toBeLessThan(2.5);
    expect(ring.length).toBeLessThanOrEqual(8);
  });

  it("skydden: för stor ändring av arean, en ring som korsar sig, för få punkter och hörn långt bort ger den förenklade ringen", () => {
    const square: Point[] = [[0, 0], [40, 0], [40, 40], [0, 40]];
    expect(pavedRingProblem(square, square, 1600)).toBeUndefined();
    expect(pavedRingProblem([[0, 0], [40, 0], [40, 33], [0, 33]], square, 1600)).toBe("arean ändras för mycket");
    expect(pavedRingProblem([[0, 0], [40, 0], [40, 40]], square, 1600)).toBe("färre än fyra punkter");
    expect(pavedRingProblem([[-6, 0], [34, 0], [34, 40], [-6, 40]], square, 1600)).toBe("ett hörn hamnar för långt bort");
    const bowTie: Point[] = [[0, 0], [40, 40], [40, 0], [0, 40]];
    expect(selfIntersects(bowTie)).toBe(true);
    expect(selfIntersects(square)).toBe(false);
    expect(pavedRingProblem(bowTie, square, 0)).toBe("ringen korsar sig själv");
    // En kompakt yta med ett urtag (fyllnadsgrad 0,92): rektangeln hamnar för långt från urtagets hörn och förkastas, och
    // ytan behåller sina sex räta hörn. Med ett skydd som inget klarar gäller den förenklade ringen från steg 1.
    const turn = rotate(20, 140, 140);
    const raw = rasterRing((x, y) => { const [u, v] = turn.from(x, y); return Math.abs(u) <= 20 && Math.abs(v) <= 15 && !(u > 10 && v > 5); });
    const notched = generalizePavedRingDetailed(raw);
    expect(notched.problem).toBeUndefined();
    expect(notched.ring).toHaveLength(6);
    const kept = generalizePavedRingDetailed(raw, { ...DEFAULT_PAVED_GENERALIZE, maxMove: 0.2 });
    expect(kept.problem).toBe("ett hörn hamnar för långt bort");
    expect(kept.ring.length).toBeGreaterThan(6);
    for (const point of kept.ring) expect(distanceToRing(point, raw)).toBeLessThan(0.01);
  });

  it("den omskrivna rektangeln och små ringar", () => {
    const box = boundingRectangle([[0, 0], [10, 10], [0, 20], [-10, 10]])!;
    expect(box.area).toBeCloseTo(200, 6);
    expect(generalizePavedRing([[0, 0], [2, 0], [2, 2]])).toEqual([[0, 0], [2, 0], [2, 2]]);
  });
});

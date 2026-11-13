import { describe, expect, it } from "vitest";
import { blurMask, contourRings, smoothMaskRings } from "../../../scripts/geo-paved-contour";
import {
  boundingRectangle, DEFAULT_PAVED_GENERALIZE, distanceToRing, generalizePavedRing, generalizePavedRingDetailed, mainDirection, pavedRingProblem, selfIntersects, signedArea
} from "../../../scripts/geo-paved-generalize";

type Point = [number, number];
const CELL = 2;
/** Maskens utjämnade kant för ytan `inside` (cellens mitt avgör), som geo-arbetaren ger den. */
function smoothRing(inside: (x: number, y: number) => boolean, width = 140, height = 140): Point[] {
  const mask = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) if (inside((x + 0.5) * CELL, (y + 0.5) * CELL)) mask[x * height + y] = 1;
  const rings = smoothMaskRings(mask, { minX: CELL / 2, minY: CELL / 2, cell: CELL, width, height });
  expect(rings).toHaveLength(1);
  return rings[0]!;
}
const rotate = (angle: number, cx: number, cy: number) => {
  const cos = Math.cos(angle * Math.PI / 180), sin = Math.sin(angle * Math.PI / 180);
  return { to: ([u, v]: Point): Point => [cx + u * cos - v * sin, cy + u * sin + v * cos], from: (x: number, y: number): Point => [(x - cx) * cos + (y - cy) * sin, -(x - cx) * sin + (y - cy) * cos] };
};
const nearest = (point: Point, ring: readonly Point[]) => Math.min(...ring.map(other => Math.hypot(other[0] - point[0], other[1] - point[1])));
/** Hörnens svängar i grader (0 = rakt fram). */
const turns = (ring: readonly Point[]) => ring.map((b, i) => {
  const a = ring[(i + ring.length - 1) % ring.length]!, c = ring[(i + 1) % ring.length]!;
  return Math.abs(Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]))) * 180 / Math.PI;
});

describe("de belagda ytornas kant och generalisering (ägaren 2026-11-13)", () => {
  it("konturen: en ensam cell i ett fält ger en moturs ring kring cellens mitt, ett hål en medurs, och ramen sluter ytor vid kanten", () => {
    const grid = { minX: 1, minY: 1, cell: 2, width: 5, height: 5 };
    const field = new Float32Array(25);
    field[2 * 5 + 2] = 1;
    const dot = contourRings(field, grid);
    expect(dot).toHaveLength(1);
    expect([...dot[0]!].sort((a, b) => a[0] - b[0] || a[1] - b[1])).toEqual([[4, 5], [5, 4], [5, 6], [6, 5]]);
    expect(signedArea(dot[0]!)).toBe(2);
    const hole = contourRings(field.map(value => 1 - value), grid);
    expect(hole.map(ring => Math.sign(signedArea(ring))).sort()).toEqual([-1, 1]);
    // Ytterkanten ligger en halv cell utanför de yttersta cellernas mitt (mot ramens nollor).
    expect(Math.max(...hole.flat().map(point => point[0]))).toBe(10);
    // Sadelfallet: två celler som bara möts i ett hörn är två ringar när rutans medel är under nivån, en när det är över.
    const saddle = new Float32Array(25);
    saddle[1 * 5 + 1] = 0.9; saddle[2 * 5 + 2] = 0.9;
    expect(contourRings(saddle, grid)).toHaveLength(2);
    saddle[1 * 5 + 2] = 0.3; saddle[2 * 5 + 1] = 0.3;
    expect(contourRings(saddle, grid)).toHaveLength(1);
    // Utjämningen bevarar summan mitt i fältet.
    const blurred = blurMask(Uint8Array.from({ length: 21 * 21 }, (_, i) => i === 10 * 21 + 10 ? 1 : 0), 21, 21);
    expect(blurred.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
  });

  it("en rak 8 m bred gata i 30° vinkel får raka kanter nära de sanna och få punkter", () => {
    const turn = rotate(30, 190, 140);
    const street = (x: number, y: number) => { const [u, v] = turn.from(x, y); return Math.abs(u) <= 170 && Math.abs(v) <= 4; };
    const truth = ([[-170, -4], [170, -4], [170, 4], [-170, 4]] as Point[]).map(turn.to);
    // Bara utjämningen och förenklingen (utan räta vinklar): kanten följer gatan, utan trappsteg.
    const smooth = generalizePavedRing(smoothRing(street, 190, 140), undefined, false);
    expect(smooth.length).toBeLessThanOrEqual(12);
    for (const point of smooth) expect(distanceToRing(point, truth)).toBeLessThan(1.5);
    // Med räta vinklar: fyra hörn (ytan är över 2 500 m², så det är kanterna som vrids och gatans rundade ändar som rätas).
    const ring = generalizePavedRing(smoothRing(street, 190, 140));
    expect(ring).toHaveLength(4);
    for (const point of ring) expect(distanceToRing(point, truth)).toBeLessThan(1.5);
    for (const corner of truth) expect(nearest(corner, ring)).toBeLessThan(2);
  });

  it("en rektangel på 30 × 60 m, vriden 20°, blir fyra hörn nära de sanna", () => {
    const turn = rotate(20, 140, 140);
    const raw = smoothRing((x, y) => { const [u, v] = turn.from(x, y); return Math.abs(u) <= 30 && Math.abs(v) <= 15; });
    expect(raw.length).toBeGreaterThan(40);
    const ring = generalizePavedRing(raw);
    expect(ring).toHaveLength(4);
    const truth = ([[-30, -15], [30, -15], [30, 15], [-30, 15]] as Point[]).map(turn.to);
    for (const corner of truth) expect(nearest(corner, ring)).toBeLessThan(1.5);
    for (const angle of turns(ring)) expect(angle).toBeCloseTo(90, 1);
    expect(Math.abs(signedArea(ring))).toBeCloseTo(Math.abs(signedArea(raw)), 0);
    // Ett hål (medurs) generaliseras på samma sätt och förblir medurs.
    const hole = generalizePavedRing([...raw].reverse());
    expect(hole).toHaveLength(4);
    expect(signedArea(hole)).toBeLessThan(0);
  });

  it("en L-formad yta behåller sex hörn med räta vinklar", () => {
    const turn = rotate(20, 140, 140);
    // 80 × 80 m utan kvadranten uppe till höger: tre fjärdedelar av sin omskrivna rektangel.
    const ring = generalizePavedRing(smoothRing((x, y) => { const [u, v] = turn.from(x, y); return Math.abs(u) <= 40 && Math.abs(v) <= 40 && !(u > 0 && v > 0); }));
    expect(ring).toHaveLength(6);
    for (const angle of turns(ring)) expect(angle).toBeCloseTo(90, 1);
    const truth = ([[-40, -40], [40, -40], [40, 0], [0, 0], [0, 40], [-40, 40]] as Point[]).map(turn.to);
    for (const corner of truth) expect(nearest(corner, ring)).toBeLessThan(2);
    expect(mainDirection(ring, 12).share).toBeCloseTo(1, 5);
    expect(Math.abs(mainDirection(ring, 12).angle * 180 / Math.PI - 20)).toBeLessThan(1);
  });

  it("en svängd gata behåller sin form utan hack och blir inte en rektangel", () => {
    // En båge: 8 m bred, radie 80 m, ett kvarts varv.
    const inside = (x: number, y: number) => { const r = Math.hypot(x - 20, y - 20), a = Math.atan2(y - 20, x - 20); return Math.abs(r - 80) <= 4 && a >= 0.05 && a <= Math.PI / 2 - 0.05; };
    const detailed = generalizePavedRingDetailed(smoothRing(inside));
    expect(detailed.problem).toBeUndefined();
    const ring = detailed.ring;
    expect(ring.length).toBeGreaterThan(8);
    expect(mainDirection(ring, 12).share).toBeLessThan(0.7);
    // Kanten ligger inom 1,5 m från bågens sanna kanter (radie 76 och 84 m) utom vid de rundade ändarna.
    const alongArc = ring.filter(([x, y]) => { const a = Math.atan2(y - 20, x - 20); return a > 0.15 && a < Math.PI / 2 - 0.15; });
    expect(alongArc.length).toBeGreaterThan(6);
    for (const [x, y] of alongArc) expect(Math.min(Math.abs(Math.hypot(x - 20, y - 20) - 76), Math.abs(Math.hypot(x - 20, y - 20) - 84))).toBeLessThan(1.5);
    // Inga hack: längs bågen svänger kanten lite och alltid åt samma håll per sida; bara ändarna har skarpa hörn.
    const angles = turns(ring);
    ring.forEach((point, i) => { if (alongArc.includes(point)) expect(angles[i]).toBeLessThan(30); });
    const radial = (point: Point) => Math.hypot(point[0] - 20, point[1] - 20);
    for (const side of [alongArc.filter(point => radial(point) > 80), alongArc.filter(point => radial(point) < 80)]) {
      for (const point of side) expect(Math.abs(radial(point) - radial(side[0]!))).toBeLessThan(1.5);
    }
  });

  it("en rak gata som svänger svagt vrids inte till huvudriktningen", () => {
    // 200 m gata, 8 m bred, i två raka delar med 8° mellan sig: båda ligger inom 12° men skulle flyttas för långt.
    const inside = (x: number, y: number) => { const u = x - 20, v = y - 60 - (u > 100 ? (u - 100) * Math.tan(8 * Math.PI / 180) : 0); return u >= 0 && u <= 200 && Math.abs(v) <= 4; };
    const raw = smoothRing(inside), ring = generalizePavedRing(raw);
    for (const point of raw) expect(distanceToRing(point, ring)).toBeLessThan(2);
    expect(ring.length).toBeLessThanOrEqual(12);
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
    const raw = smoothRing((x, y) => { const [u, v] = turn.from(x, y); return Math.abs(u) <= 20 && Math.abs(v) <= 15 && !(u > 10 && v > 5); });
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

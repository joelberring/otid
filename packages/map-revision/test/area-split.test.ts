import { describe, expect, it } from "vitest";
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import type { MapObject } from "@o-tid/map-file";
import { AREA_SPLIT_TABLE, areaSplitLimit, largeAreaPlan, splitArea, splitLargeAreas } from "../src";
import { areaPolygon, multiArea, polygonArea, polygonBox } from "../src/area-split";

type Area = Extract<MapObject, { kind: "area" }>;
const ring = (points: readonly [number, number][]) => points.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y }));
const area = (symbol: string, ...rings: [number, number][][]): Area => ({ kind: "area", symbol, rings: rings.map(ring), angle: 0 });
const shoelace = (points: readonly { x: number; y: number }[]) => Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]!; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
const areaOf = (object: Area) => object.rings.reduce((sum, path, index) => sum + (index === 0 ? 1 : -1) * shoelace(path), 0);

describe("stora ytor delas (ägaren 2026-11-23: «ytorna inte sitter ihop i superstora delar … ganska stora ok»)", () => {
  // Sprintkarta 1:4 000: 3 ha = 1 875 mm², rutnätet 150 m = 37,5 mm.
  const sprint = areaSplitLimit("406", "ISSPROM", 4000)!;
  it("gränsen per norm och symbol i kartans mm; vatten («typ hav får gärna vara större»), hus och oframkomligt delas aldrig", () => {
    expect(sprint.maxMm2).toBeCloseTo(30_000 / 16, 6);
    expect(sprint.gridMm).toBeCloseTo(37.5, 6);
    expect(areaSplitLimit("401", "ISOM", 10000)?.maxMm2).toBeCloseTo(2000, 6);
    for (const code of ["301", "302", "303", "307", "411", "521", "522"]) expect(areaSplitLimit(code, "ISSPROM", 4000), code).toBeUndefined();
    for (const code of ["501", "520", "214", "308", "403"]) expect(areaSplitLimit(code, "ISSPROM", 4000), code).toBeDefined();
    expect(AREA_SPLIT_TABLE.sprint.rows.at(-1)?.maxM2).toBe(30_000);
  });

  it("en yta under gränsen lämnas orörd (också kurvorna)", () => {
    const small = area("401", [[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]]);
    expect(splitArea(small, sprint)).toEqual([small]);
  });

  it("en park på 100 × 80 mm (12,8 ha) blir bitar under 3 ha, kant i kant med samma punkter och samma totala yta", () => {
    const park = area("406", [[1, 1], [101, 1], [101, 81], [1, 81], [1, 1]], [[40, 30], [50, 30], [50, 40], [40, 40], [40, 30]]);
    const pieces = splitArea(park, sprint);
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    for (const piece of pieces) {
      expect(areaOf(piece)).toBeLessThanOrEqual(sprint.maxMm2 + 1e-6);
      expect(piece.symbol).toBe("406");
    }
    expect(pieces.reduce((sum, piece) => sum + areaOf(piece), 0)).toBeCloseTo(100 * 80 - 100, 6);
    // Snitten ligger på rutnätet (37,5 mm från kartans nollpunkt) och båda sidor har samma punkter längs snittet.
    const onCut = (piece: Area) => piece.rings.flat().filter(point => Math.abs(point.x / sprint.gridMm - Math.round(point.x / sprint.gridMm)) < 1e-9
      && point.x > 1 && point.x < 101).map(point => `${point.x},${point.y}`);
    const shared = pieces.flatMap(onCut);
    expect(shared.length).toBeGreaterThan(0);
    for (const key of new Set(shared)) expect(shared.filter(other => other === key).length, key).toBeGreaterThanOrEqual(2);
  });

  it("delar i midjan: två fält förbundna med ett smalt band delas där bandet är", () => {
    // Två fält 60 × 40 mm med ett band 3 mm brett emellan (x 60–80); rutnätets linje x = 75 korsar bandet.
    const fields = area("401", [[0, 0], [60, 0], [60, 20], [80, 20], [80, 0], [140, 0], [140, 40], [80, 40], [80, 23], [60, 23], [60, 40], [0, 40], [0, 0]]);
    const pieces = splitArea(fields, sprint);
    // Första snittet i bandet (3 mm) i stället för tvärs ett fält (40 mm).
    const cutAt75 = pieces.some(piece => piece.rings.flat().some(point => point.x === 75 && point.y >= 20 && point.y <= 23));
    expect(cutAt75).toBe(true);
  });

  it("bara markytor delas, aldrig hus eller vatten; befintliga ytor i «Dela stora ytor»", () => {
    const big = [[0, 0], [120, 0], [120, 120], [0, 120], [0, 0]] as [number, number][];
    const out = splitLargeAreas([area("a", big), area("b", big)], symbol => symbol === "a" ? "403" : "301", "ISSPROM", 4000);
    expect(out.filter(object => object.symbol === "a").length).toBeGreaterThan(1);
    expect(out.filter(object => object.symbol === "b")).toHaveLength(1);
    const plan = largeAreaPlan([{ key: "k", code: "520", object: area("a", big) }, { key: "s", code: "520", object: area("a", [[0, 0], [10, 0], [10, 10], [0, 0]]) }], "ISSPROM", 4000);
    expect(plan.map(row => row.key)).toEqual(["k"]);
    expect(plan[0]!.areaM2).toBeCloseTo(120 * 120 * 16, 0);
  });

  it("korrupta jättekoordinater låser inte rutnätsloopen", () => {
    const giant = area("406", [[0, 0], [1e9, 0], [1e9, 100], [0, 100], [0, 0]]);
    const started = performance.now();
    const pieces = splitArea(giant, sprint);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(pieces.length).toBeGreaterThanOrEqual(1);
  });

  it("O(V)-snittberäkning ger samma delningar (paritet) som full polygonClipping-sökning på konkava ytor, hål och kanter längs rutnätet", () => {
    // Referensimplementation som testar varje rutnätslinje med polygonClipping.intersection.
    const refHalves = (piece: Polygon, axis: "x" | "y", c: number): [MultiPolygon, MultiPolygon] => {
      const box = polygonBox(piece), pad = 1 + Math.max(box.maxX - box.minX, box.maxY - box.minY);
      const lo = { minX: box.minX - pad, minY: box.minY - pad }, hi = { maxX: box.maxX + pad, maxY: box.maxY + pad };
      const rect = (a: [number, number], b: [number, number], far: [number, number], farB: [number, number]): Polygon => [[a, b, farB, far, a]];
      const first = axis === "x" ? rect([c, lo.minY], [c, hi.maxY], [lo.minX, lo.minY], [lo.minX, hi.maxY])
        : rect([lo.minX, c], [hi.maxX, c], [lo.minX, lo.minY], [hi.maxX, lo.minY]);
      const second = axis === "x" ? rect([c, lo.minY], [c, hi.maxY], [hi.maxX, lo.minY], [hi.maxX, hi.maxY])
        : rect([lo.minX, c], [hi.maxX, c], [lo.minX, hi.maxY], [hi.maxX, hi.maxY]);
      return [polygonClipping.intersection(piece, first), polygonClipping.intersection(piece, second)];
    };
    const refCutLength = (parts: MultiPolygon, axis: "x" | "y", c: number) => {
      let sum = 0;
      for (const piece of parts) for (const r of piece) for (let i = 1; i < r.length; i += 1) {
        const [ax, ay] = r[i - 1]!, [bx, by] = r[i]!;
        const [a, b, along] = axis === "x" ? [ax, bx, Math.abs(ay - by)] : [ay, by, Math.abs(ax - bx)];
        if (Math.abs(a - c) < 1e-9 && Math.abs(b - c) < 1e-9) sum += along;
      }
      return sum;
    };
    const refSplit = (obj: Area): number[] => {
      const done: Polygon[] = [], queue: Polygon[] = [areaPolygon(obj)];
      while (queue.length) {
        const piece = queue.pop()!, a0 = polygonArea(piece);
        if (a0 <= sprint.maxMm2) { done.push(piece); continue; }
        const box = polygonBox(piece);
        let best: { parts: [MultiPolygon, MultiPolygon]; score: number } | undefined;
        for (const axis of ["x", "y"] as const) {
          const from = axis === "x" ? box.minX : box.minY, to = axis === "x" ? box.maxX : box.maxY, middle = (from + to) / 2;
          for (let k = Math.floor(from / sprint.gridMm) + 1; k <= Math.ceil(to / sprint.gridMm) - 1; k += 1) {
            const c = k * sprint.gridMm;
            const parts = refHalves(piece, axis, c);
            const a = multiArea(parts[0]), b = multiArea(parts[1]);
            if (a <= 0 || b <= 0) continue;
            const score = Math.min(a, b) >= 0.2 * a0 ? refCutLength(parts[0], axis, c) / Math.sqrt(a0) : 1e6 + Math.abs(c - middle);
            if (!best || score < best.score) best = { parts, score };
          }
        }
        if (!best) { done.push(piece); continue; }
        queue.push(...best.parts[0], ...best.parts[1]);
      }
      return done.map(polygonArea).sort((x, y) => x - y);
    };

    const shapes: Area[] = [
      // C-formad konkav yta med multipla snitt längs samma rutnätslinje.
      area("406", [[0, 0], [120, 0], [120, 30], [35, 30], [35, 70], [120, 70], [120, 100], [0, 100], [0, 0]]),
      // L-formad yta där en vertikal kant ligger exakt på rutnätslinjen x = 75.
      area("406", [[0, 0], [130, 0], [130, 45], [75, 45], [75, 110], [0, 110], [0, 0]]),
      // Yta med hål och sneda sidor.
      area("406", [[5, 5], [140, 15], [135, 95], [10, 85], [5, 5]], [[50, 30], [90, 35], [85, 65], [45, 60], [50, 30]])
    ];
    for (const shape of shapes) {
      const fastAreas = splitArea(shape, sprint).map(areaOf).sort((x, y) => x - y);
      const refAreas = refSplit(shape);
      expect(fastAreas).toHaveLength(refAreas.length);
      for (let i = 0; i < refAreas.length; i += 1) {
        expect(fastAreas[i]).toBeCloseTo(refAreas[i]!, 5);
      }
    }
  });
});

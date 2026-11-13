import polygonClipping from "polygon-clipping";
import { describe, expect, it } from "vitest";
import type { Point } from "@o-tid/map-file";
import { nextPartNumber, planAreaSplit, polygonArea, splitPolygon } from "./map-project-area-split";

const square: Point[][] = [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]];
const key = (point: Point) => `${point.x},${point.y}`;
const geom = (polygon: readonly (readonly Point[])[]) => polygon.map(ring => ring.map(point => [point.x, point.y] as [number, number]));
const areaOf = (multi: polygonClipping.MultiPolygon) => multi.reduce((sum, polygon) => sum + polygonArea(polygon.map(ring => ring.map(([x, y]) => ({ x, y })))), 0);

/** Delarna täcker polygonen, överlappar inte, och varje punkt på snittet finns med samma koordinater i minst två delar. */
function expectExactCover(polygon: Point[][], parts: Point[][][]) {
  const total = parts.reduce((sum, part) => sum + polygonArea(part), 0);
  expect(total).toBeCloseTo(polygonArea(polygon), 6);
  for (let i = 0; i < parts.length; i += 1) for (let j = i + 1; j < parts.length; j += 1) {
    expect(areaOf(polygonClipping.intersection([geom(parts[i]!)], [geom(parts[j]!)]))).toBeLessThan(1e-6);
  }
  expect(areaOf(polygonClipping.xor([geom(polygon)], ...parts.map(part => [geom(part)])))).toBeLessThan(1e-6);
  const original = new Set(polygon.flat().map(key));
  const seen = new Map<string, number>();
  for (const part of parts) for (const id of new Set(part.flat().map(key))) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const [id, count] of seen) if (!original.has(id)) expect(count, id).toBeGreaterThanOrEqual(2);
}

describe("splitPolygon", () => {
  it("delar en kvadrat med ett rakt streck i två delar med gemensam gräns", () => {
    const result = splitPolygon(square, [{ x: 40, y: -10 }, { x: 40, y: 110 }]);
    expect(result.status).toBe("split");
    if (result.status !== "split") return;
    expect(result.parts).toHaveLength(2);
    expect(result.parts.map(polygonArea)).toEqual([6000, 4000]);
    expectExactCover(square, result.parts);
    // Snittets ändar ligger på kanten och finns i båda delarna.
    for (const part of result.parts) expect(part[0]!.map(key)).toEqual(expect.arrayContaining(["40,0", "40,100"]));
  });

  it("behåller streckets brytpunkter i båda delarna, även med sneda skärningar", () => {
    const line = [{ x: -5, y: 31.7 }, { x: 33.3, y: 47.1 }, { x: 61.9, y: 22.2 }, { x: 130, y: 71.3 }];
    const result = splitPolygon(square, line);
    expect(result.status).toBe("split");
    if (result.status !== "split") return;
    expect(result.parts).toHaveLength(2);
    expectExactCover(square, result.parts);
    for (const part of result.parts) expect(part[0]!.map(key)).toEqual(expect.arrayContaining(["33.3,47.1", "61.9,22.2"]));
  });

  it("förlänger en ände som slutar strax innanför kanten, men inte en som slutar långt in", () => {
    const short = [{ x: 50, y: 3 }, { x: 50, y: 98 }];
    expect(splitPolygon(square, short).status).toBe("not-across");
    const result = splitPolygon(square, short, 5);
    expect(result.status).toBe("split");
    if (result.status !== "split") return;
    expect(result.parts.map(polygonArea)).toEqual([5000, 5000]);
    expectExactCover(square, result.parts);
    expect(splitPolygon(square, [{ x: 50, y: -10 }, { x: 50, y: 60 }], 5).status).toBe("not-across");
  });

  it("säger till när strecket inte går in i polygonen", () => {
    expect(splitPolygon(square, [{ x: 150, y: 0 }, { x: 150, y: 100 }]).status).toBe("outside");
    expect(splitPolygon(square, [{ x: 50, y: 50 }]).status).toBe("outside");
    // Längs kanten delar ingenting.
    expect(splitPolygon(square, [{ x: 0, y: -10 }, { x: 0, y: 110 }]).status).toBe("outside");
  });

  it("delar genom ett hörn", () => {
    const result = splitPolygon(square, [{ x: -10, y: -10 }, { x: 110, y: 110 }]);
    expect(result.status).toBe("split");
    if (result.status !== "split") return;
    expect(result.parts.map(part => part[0]!.length)).toEqual([3, 3]);
    expectExactCover(square, result.parts);
  });

  it("ger tre delar när strecket korsar en U-form två gånger", () => {
    const u: Point[][] = [[{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 100 }, { x: 60, y: 100 }, { x: 60, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 100 }, { x: 0, y: 100 }]];
    const result = splitPolygon(u, [{ x: -10, y: 70 }, { x: 100, y: 70 }]);
    expect(result.status).toBe("split");
    if (result.status !== "split") return;
    expect(result.parts).toHaveLength(3);
    expectExactCover(u, result.parts);
    // Ett streck som korsar ena armen och slutar i den andra delar bara den första.
    const one = splitPolygon(u, [{ x: -10, y: 70 }, { x: 75, y: 70 }]);
    expect(one.status === "split" && one.parts.length).toBe(2);
    if (one.status === "split") expectExactCover(u, one.parts);
  });

  it("hanterar hål: ett orört hål följer med sin del, ett genomskuret hål blir en del av kanten", () => {
    const holed: Point[][] = [...square, [{ x: 60, y: 40 }, { x: 80, y: 40 }, { x: 80, y: 60 }, { x: 60, y: 60 }]];
    const beside = splitPolygon(holed, [{ x: 30, y: -1 }, { x: 30, y: 101 }]);
    expect(beside.status).toBe("split");
    if (beside.status !== "split") return;
    expect(beside.parts.map(part => part.length)).toEqual([2, 1]);
    expectExactCover(holed, beside.parts);
    const through = splitPolygon(holed, [{ x: 70, y: -1 }, { x: 70, y: 101 }]);
    expect(through.status).toBe("split");
    if (through.status !== "split") return;
    expect(through.parts.map(part => part.length)).toEqual([1, 1]);
    expectExactCover(holed, through.parts);
    // Från kanten in till hålet: delar ingenting.
    expect(splitPolygon(holed, [{ x: 70, y: -1 }, { x: 70, y: 50 }]).status).toBe("not-across");
  });

  it("tål medurs ritad polygon och ett streck som korsar sig självt", () => {
    const clockwise = [[...square[0]!].reverse()];
    const result = splitPolygon(clockwise, [{ x: -10, y: 20 }, { x: 70, y: 20 }, { x: 70, y: 80 }, { x: 40, y: 80 }, { x: 40, y: -10 }]);
    expect(result.status).toBe("split");
    if (result.status === "split") { expect(result.parts).toHaveLength(3); expectExactCover(square, result.parts); }
  });
});

describe("planAreaSplit", () => {
  const line = [{ x: 50, y: -10 }, { x: 50, y: 110 }];
  it("delar hela kartområdet första gången", () => {
    const plan = planAreaSplit([], square, line);
    expect(plan.status === "split" && [plan.changed.length, plan.added.length, plan.added[0]!.from]).toEqual([0, 2, undefined]);
    expect(planAreaSplit([], undefined, line).status).toBe("outside");
  });

  it("delar sedan den del strecket korsar och lämnar grannen orörd", () => {
    const first = splitPolygon(square, line);
    if (first.status !== "split") throw new Error("ingen delning");
    const areas = first.parts.map((polygon, index) => ({ areaId: `a${index}`, polygon }));
    const west = areas.find(area => area.polygon[0]!.some(point => point.x === 0))!;
    const plan = planAreaSplit(areas, square, [{ x: -5, y: 50 }, { x: 49, y: 50 }]);
    expect(plan.status).toBe("split");
    if (plan.status !== "split") return;
    expect(plan.changed.map(item => item.areaId)).toEqual([west.areaId]);
    expect(plan.added.map(item => item.from)).toEqual([west.areaId]);
    expectExactCover(west.polygon, [plan.changed[0]!.polygon, plan.added[0]!.polygon]);
    // Tvärs över båda: båda delas. Med en vald del: bara den.
    const both = planAreaSplit(areas, square, [{ x: -5, y: 50 }, { x: 105, y: 50 }]);
    expect(both.status === "split" && both.changed.length).toBe(2);
    const only = planAreaSplit(areas, square, [{ x: -5, y: 50 }, { x: 105, y: 50 }], "a1");
    expect(only.status === "split" && only.changed.map(item => item.areaId)).toEqual(["a1"]);
    // Slutar mitt i en del: besked, och hela kartan delas inte i stället.
    expect(planAreaSplit(areas, square, [{ x: -5, y: 50 }, { x: 25, y: 50 }]).status).toBe("not-across");
  });

  it("vägrar delar som blir för stora för servern", () => {
    const many: Point[] = [];
    for (let i = 0; i <= 2100; i += 1) many.push({ x: i, y: 0 });
    const big = [[...many, { x: 2100, y: 100 }, { x: 0, y: 100 }]];
    expect(planAreaSplit([], big, [{ x: -5, y: 99 }, { x: 2105, y: 99 }]).status).toBe("too-complex");
  });
});

describe("nextPartNumber", () => {
  it("ger ett mer än det högsta numret", () => {
    expect(nextPartNumber([], "Del")).toBe(1);
    expect(nextPartNumber(["Del 1", "Norr", "Del 4", "Delta 9", "Del x"], "Del")).toBe(5);
  });
});

import { describe, expect, it } from "vitest";
import type { MapObject, PathCommand } from "@o-tid/map-file";
import { generalize, generalizeCandidates, proposalBase, simplifyObject, simplifyPoints, type NormObject, type RevisionClientState } from "../src";

/** ADR-0219 K6 del 1: generaliseringen som förslag (förenkla, ta bort det normen inte tillåter). */
const path = (points: [number, number][]): PathCommand[] => points.map(([x, y], index) => ({ type: index === 0 ? "M" : "L", x, y }));
const line = (key: string, code: string, points: [number, number][]): NormObject =>
  ({ key: `n:${key}`, code, object: { kind: "line", symbol: code, path: path(points) } as MapObject });
const area = (key: string, code: string, points: [number, number][]): NormObject =>
  ({ key: `n:${key}`, code, object: { kind: "area", symbol: code, rings: [path(points)], angle: 0 } as MapObject });
/** En nästan rak linje med små krusningar (som Karttapullautins kurvor). */
const wiggly = (count: number, amplitude: number): [number, number][] =>
  Array.from({ length: count }, (_, i) => [i * 0.2, (i % 2 === 0 ? 1 : -1) * amplitude] as [number, number]);

describe("generaliseringen", () => {
  it("Douglas–Peucker behåller ändarna och hörnen men tar krusningarna", () => {
    const points = wiggly(50, 0.01).map(([x, y]) => ({ x, y }));
    expect(simplifyPoints(points, 0.05)).toEqual([points[0], points[49]]);
    const corner = [{ x: 0, y: 0 }, { x: 5, y: 0.01 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 10 }];
    expect(simplifyPoints(corner, 0.05)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(simplifyPoints(corner, 0)).toEqual(corner);
  });

  it("förenklar linjer och ytor men inte kurvor och inte under tre punkter i en ring", () => {
    const simplified = simplifyObject(line("a", "101", wiggly(40, 0.01)).object, 0.05);
    expect(simplified).toMatchObject({ before: 40, after: 2 });
    const ring: [number, number][] = [[0, 0], [2, 0.005], [4, 0], [4, 2], [4, 4], [2, 4.005], [0, 4], [0, 2], [0, 0]];
    const square = simplifyObject(area("b", "401", ring).object, 0.05);
    expect(square?.after).toBe(5);
    expect(square?.object.kind === "area" && square.object.rings[0]!.length).toBe(5);
    const curve = { kind: "line", symbol: "101", path: [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 1, y1: 1, x2: 2, y2: 1, x: 3, y: 0 }] } as MapObject;
    expect(simplifyObject(curve, 0.1)).toBeUndefined();
    expect(simplifyObject(area("c", "401", [[0, 0], [1, 0.001], [2, 0], [0, 0]]).object, 1)).toBeUndefined();
  });

  it("tar bort det som är mindre än normen och förenklar resten, inom en ruta", () => {
    const objects = [
      area("liten", "401", [[0, 0], [0.3, 0], [0.3, 0.3], [0, 0.3], [0, 0]]),
      line("kort", "516", [[10, 10], [10.5, 10]]),
      line("kurva", "101", wiggly(30, 0.01).map(([x, y]) => [x + 20, y + 20] as [number, number])),
      line("utanför", "101", wiggly(30, 0.01).map(([x, y]) => [x + 200, y + 200] as [number, number]))
    ];
    const result = generalize(objects, 15000, { simplifyMm: 0.05, removeSmall: true, within: { minX: -5, minY: -5, maxX: 100, maxY: 100 } });
    expect(result.removed).toEqual({ SMALL_AREA: 1, SHORT_LINE: 1, SMALL_CLOSED: 0 });
    expect(result.changes.map(change => [change.key, change.reason]).sort()).toEqual([["n:kort", "SHORT_LINE"], ["n:kurva", "SIMPLIFY"], ["n:liten", "SMALL_AREA"]]);
    expect(result).toMatchObject({ simplified: 1, pointsBefore: 30, pointsAfter: 2 });
    expect(generalize(objects, 15000, { simplifyMm: 0, removeSmall: false }).changes).toEqual([]);
  });

  it("förslagets grund: serverns senaste ändring, inget när objektet har egna ändringar eller en krock", () => {
    const state = { server: { "n:a": { lastEditId: "e1" } }, pending: [{ key: "n:b" }], conflicts: { "n:c": {} }, proposed: {} } as unknown as RevisionClientState;
    expect(proposalBase(state, "n:a")).toEqual({ base: "e1" });
    expect(proposalBase(state, "b:x")).toEqual({ base: null });
    expect(proposalBase(state, "n:b")).toBeUndefined();
    expect(proposalBase(state, "n:c")).toBeUndefined();
  });
});

describe("kandidaterna generaliseras före Lägg in", () => {
  it("tar bort en för liten yta, förenklar en tät linje och behåller resten", () => {
    const tiny = area("a", "401", [[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2]]).object;
    const big = area("b", "401", [[0, 0], [20, 0], [20, 20], [0, 20]]).object;
    const dense = line("c", "101", wiggly(200, 0.01)).object;
    const codes: Record<string, string> = { [tiny.symbol]: "401", [dense.symbol]: "101" };
    const result = generalizeCandidates([tiny, big, dense], symbol => codes[symbol], 10000);
    expect(result.removed).toBe(1);
    expect(result.objects).toHaveLength(2);
    expect(result.simplified).toBeGreaterThanOrEqual(1);
  });
  it("gör kurvor, branter och gröna ytor mjuka, men inte andra symboler (ägaren 2026-11-11)", () => {
    const contour = line("k", "101", [[0, 0], [5, 2], [10, 0], [15, 3]]);
    const path505 = line("s", "505", [[0, 0], [5, 2], [10, 0], [15, 3]]);
    const green = area("g", "406", [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]);
    const result = generalize([contour, path505, green], 10000, { simplifyMm: 0, removeSmall: false, smooth: ["101", "406"] });
    expect(result.smoothed).toBe(2);
    expect(result.changes.map(change => [change.key, change.reason]).sort()).toEqual([["n:g", "SMOOTH"], ["n:k", "SMOOTH"]]);
    const soft = result.changes.find(change => change.key === "n:k")!.object;
    expect(soft?.kind === "line" && soft.path.slice(1).every(command => command.type === "C")).toBe(true);
    // Kandidaterna: kurvorna görs mjuka som förval.
    const candidates = generalizeCandidates([contour.object], () => "101", 10000);
    expect(candidates.objects[0]!.kind === "line" && candidates.objects[0]!.path.some(command => command.type === "C")).toBe(true);
  });
});

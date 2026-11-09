import type { MapObject, PathCommand } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { areasInsideSameSymbol, generalize, joinTouchingLines, reversePath, type NormObject } from "../src";

/** ADR-0219 K6 del 2: foga ihop linjer vars ändar möts och ta bort ytor inuti en likadan yta. */
const path = (points: readonly [number, number][]): PathCommand[] => points.map(([x, y], i) => ({ type: i === 0 ? "M" : "L", x, y }));
const line = (key: string, symbol: string, points: readonly [number, number][]): NormObject =>
  ({ key: key, code: symbol, object: { kind: "line", symbol, path: path(points) } });
const area = (key: string, symbol: string, rings: readonly (readonly [number, number][])[]): NormObject =>
  ({ key: key, code: symbol, object: { kind: "area", symbol, angle: 0, rings: rings.map(ring => path(ring)) } });
const points = (object: MapObject) => object.kind === "line" ? object.path.map(command => [command.x, command.y]) : [];

describe("generaliseringens topologi", () => {
  it("fogar ihop kurvor som delats vid rutornas kanter, åt båda hållen, och sluter en ring", () => {
    const objects = [
      line("b:1", "101", [[0, 0], [5, 0]]),
      line("b:2", "101", [[10, 1], [5.02, 0]]),
      line("b:3", "101", [[-4, 2], [0, 0.01]]),
      line("b:4", "102", [[10, 1], [20, 1]]),
      // En ring i två halvor.
      line("b:5", "101", [[30, 0], [35, 5], [40, 0]]),
      line("b:6", "101", [[40, 0], [35, -5], [30, 0.03]])
    ];
    const joined = joinTouchingLines(objects);
    expect(joined).toHaveLength(2);
    expect(joined[0]).toMatchObject({ keep: "b:1", absorbed: ["b:2", "b:3"] });
    expect(points(joined[0]!.object)).toEqual([[-4, 2], [0, 0.01], [5, 0], [10, 1]]);
    const ring = points(joined[1]!.object);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring).toHaveLength(5);
  });

  it("vänder kurvor med styrpunkterna och tar bort ytor inuti en likadan yta", () => {
    const curve: PathCommand[] = [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 1, y1: 1, x2: 2, y2: 1, x: 3, y: 0, corner: true }];
    expect(reversePath(curve)).toEqual([{ type: "M", x: 3, y: 0, corner: true }, { type: "C", x1: 2, y1: 1, x2: 1, y2: 1, x: 0, y: 0 }]);
    const square = (x: number, y: number, side: number): [number, number][] => [[x, y], [x + side, y], [x + side, y + side], [x, y + side]];
    const objects = [area("b:big", "406", [square(0, 0, 10), square(6, 6, 3)]), area("b:in", "406", [square(1, 1, 2)]),
      area("b:hole", "406", [square(6.5, 6.5, 1)]), area("b:other", "408", [square(2, 2, 1)]), area("b:out", "406", [square(9, 9, 3)])];
    expect(areasInsideSameSymbol(objects).map(change => change.key)).toEqual(["b:in"]);
  });

  it("ger förslagen i generaliseringen", () => {
    const objects = [line("b:1", "101", [[0, 0], [5, 0]]), line("b:2", "101", [[5, 0], [9, 0]]),
      area("b:big", "406", [[[0, 10], [20, 10], [20, 30], [0, 30]]]), area("b:in", "406", [[[2, 12], [4, 12], [4, 14]]])];
    const result = generalize(objects, 15000, { simplifyMm: 0, removeSmall: false, joinLines: true, removeInside: true });
    expect(result.changes.map(change => [change.key, change.reason])).toEqual([["b:in", "INSIDE"], ["b:1", "JOIN"], ["b:2", "JOINED"]]);
    expect(result.joined).toEqual({ lines: 1, absorbed: 1 });
    expect(result.inside).toBe(1);
    expect(generalize(objects, 15000, { simplifyMm: 0, removeSmall: false }).changes).toEqual([]);
  });
});

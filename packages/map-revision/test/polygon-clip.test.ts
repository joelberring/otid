import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { clipLineToPolygon, clipObjectsToPolygon, clipRingToPolygon, insidePolygon } from "../src";

// En romb (kartans område) kring origo, 10 mm åt varje håll.
const area = [[{ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }, { x: 0, y: -10 }]];
const path = (points: [number, number][]) => points.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y }));

describe("kandidaterna klipps mot kartans område", () => {
  it("punkter, linjer och ytor", () => {
    expect(insidePolygon(area, { x: 0, y: 0 })).toBe(true);
    expect(insidePolygon(area, { x: 8, y: 8 })).toBe(false);
    const pieces = clipLineToPolygon([{ x: -20, y: 0 }, { x: 20, y: 0 }], area);
    expect(pieces.map(piece => piece.map(point => Math.round(point.x)))).toEqual([[-10, 10]]);
    const ring = clipRingToPolygon([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], area[0]!);
    expect(Math.max(...ring.map(point => point.x + point.y))).toBeLessThanOrEqual(10.0001);
    const objects: MapObject[] = [{ kind: "point", symbol: "s", at: { x: 9, y: 9 }, angle: 0 }, { kind: "point", symbol: "s", at: { x: 1, y: 1 }, angle: 0 },
      { kind: "line", symbol: "l", path: path([[-20, 0], [20, 0]]) }, { kind: "area", symbol: "a", rings: [path([[20, 20], [30, 20], [30, 30], [20, 20]])], angle: 0 }];
    const result = clipObjectsToPolygon(objects, area);
    expect(result.objects.map(object => object.kind)).toEqual(["point", "line"]);
    expect(result.outside).toBe(2);
    expect(result.clipped).toBe(1);
  });
});

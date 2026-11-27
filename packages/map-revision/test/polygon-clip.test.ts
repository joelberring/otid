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

  it("klipper ytor och linjer exakt mot konkava kartområden (L- och U-form) utan att tappa armar", () => {
    const lShape = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }];
    const square = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    const clippedRing = clipRingToPolygon(square, lShape);
    const ringArea = (pts: readonly { x: number; y: number }[]) => Math.abs(pts.reduce((sum, p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      return sum + p.x * q.y - q.x * p.y;
    }, 0)) / 2;
    // L-ytan är 20×20 − 10×10 = 300 mm² (Sutherland–Hodgman högg av båda armarna till 100 mm²).
    expect(ringArea(clippedRing)).toBeCloseTo(300, 4);
    expect(clippedRing.every(p => !(p.x > 10.001 && p.y > 10.001))).toBe(true);

    // U-formad konkav klipp-polygon delar en tvärgående yta och linje i två separata delar.
    const uShape = [[{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 20 }, { x: 0, y: 20 }]];
    const bar: MapObject = { kind: "area", symbol: "a", angle: 0, rings: [path([[2, 10], [28, 10], [28, 18], [2, 18], [2, 10]])] };
    const bridge: MapObject = { kind: "line", symbol: "l", path: path([[5, 14], [25, 14]]) };
    const result = clipObjectsToPolygon([bar, bridge], uShape);
    const areas = result.objects.filter(o => o.kind === "area");
    const lines = result.objects.filter(o => o.kind === "line");
    expect(areas).toHaveLength(2);
    expect(lines).toHaveLength(2);
    expect(result.clipped).toBe(2);
    expect(result.outside).toBe(0);
    // Total yta = (10−2)×(18−10) + (28−20)×(18−10) = 64 + 64 = 128 mm².
    const totalArea = areas.reduce((sum, obj) => sum + (obj.kind === "area" ? ringArea(obj.rings[0]!.map(c => ({ x: c.x, y: c.y }))) : 0), 0);
    expect(totalArea).toBeCloseTo(128, 4);
  });
});

import type { MapObject } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { angleFrom, boundsOf, centerOf, rotateObject } from "./map-project-transform";

const stone: MapObject = { kind: "point", symbol: "s", at: { x: 10, y: 0 }, angle: 350 };
const path: MapObject = { kind: "line", symbol: "s", path: [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 2, y1: 0, x2: 8, y2: 0, x: 10, y: 0 }] };

describe("flytta och vrid flera objekt", () => {
  it("rutan runt objekten och dess mitt", () => {
    expect(boundsOf([])).toBeUndefined();
    const box = boundsOf([stone, path, { kind: "point", symbol: "s", at: { x: -4, y: 6 }, angle: 0 }])!;
    expect(box).toEqual({ minX: -4, minY: 0, maxX: 10, maxY: 6 });
    expect(centerOf(box)).toEqual({ x: 3, y: 3 });
  });

  it("vrider punkter moturs runt mitten och låter symbolens vinkel följa med", () => {
    const turned = rotateObject(stone, { x: 0, y: 0 }, 90);
    if (turned.kind !== "point") throw new Error("fel sort");
    expect(turned.at.x).toBeCloseTo(0, 9);
    expect(turned.at.y).toBeCloseTo(10, 9);
    expect(turned.angle).toBe(80);
  });

  it("vrider kurvans styrpunkter med", () => {
    const turned = rotateObject(path, { x: 0, y: 0 }, 180);
    if (turned.kind !== "line") throw new Error("fel sort");
    const curve = turned.path[1]!;
    if (curve.type !== "C") throw new Error("ingen kurva");
    expect([curve.x1, curve.x2, curve.x].map(value => Math.round(value))).toEqual([-2, -8, -10]);
    expect(Math.abs(curve.y)).toBeLessThan(1e-9);
  });

  it("ett helt varv ger samma objekt", () => {
    const turned = rotateObject(rotateObject(path, { x: 3, y: 4 }, 200), { x: 3, y: 4 }, 160);
    if (turned.kind !== "line") throw new Error("fel sort");
    expect(turned.path[1]!.x).toBeCloseTo(10, 9);
    expect(turned.path[1]!.y).toBeCloseTo(0, 9);
  });

  it("vinkeln från mitten räknas moturs", () => {
    expect(angleFrom({ x: 0, y: 0 }, { x: 0, y: 5 })).toBeCloseTo(90, 9);
    expect(angleFrom({ x: 1, y: 1 }, { x: 0, y: 1 })).toBeCloseTo(180, 9);
  });
});

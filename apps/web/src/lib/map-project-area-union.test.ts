import { describe, expect, it } from "vitest";
import type { MapObject, PathCommand } from "@o-tid/map-file";
import { unionAreas } from "./map-project-area-union";

const square = (symbol: string, x: number, y: number, size: number): MapObject => ({ kind: "area", symbol, angle: 0,
  rings: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]].map(([px, py], i) => ({ type: i === 0 ? "M" : "L", x: px!, y: py! }) as PathCommand)] }) as MapObject;

describe("slå ihop ytor (ägaren 2026-11-11)", () => {
  it("två överlappande ytor med samma symbol blir en, en fristående och en annan symbol lämnas", () => {
    const result = unionAreas([square("a", 0, 0, 10), square("b", 5, 5, 10), square("a", 5, 5, 10), square("a", 50, 50, 5)]);
    expect(result?.used).toEqual([0, 2]);
    const ring = result?.object.kind === "area" ? result.object.rings[0]! : [];
    const xs = ring.map(command => command.x), ys = ring.map(command => command.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 15, 0, 15]);
  });
  it("inget när ytorna inte hänger ihop", () => {
    expect(unionAreas([square("a", 0, 0, 10), square("a", 50, 50, 5)])).toBeUndefined();
  });
});

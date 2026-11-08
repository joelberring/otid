import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { bendSegment, insertOnSegment, moveHandle, nearestSegment, vertexHandles } from "../src";

/** K3 (ägaren 2026-11-08): punkter på kurvor, böja en sträcka och dra styrpunkterna. */
const straight: MapObject = { kind: "line", symbol: "505", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0, dash: true }] };
const curved: MapObject = { kind: "line", symbol: "505", path: [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 3, y1: 4, x2: 7, y2: 4, x: 10, y: 0 },
  { type: "C", x1: 13, y1: -4, x2: 17, y2: -4, x: 20, y: 0 }] };
const square: MapObject = { kind: "area", symbol: "401", angle: 0, rings: [[{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 10, y: 10 },
  { type: "L", x: 0, y: 10 }]] };
const pathOf = (object: MapObject) => object.kind === "line" ? object.path : object.kind === "area" ? object.rings[0]! : [];

describe("kurvorna (K3)", () => {
  it("närmaste sträcka, rak och kurva, och ytans stängande sträcka", () => {
    expect(nearestSegment(straight, { x: 4, y: 0.3 }, 1)).toMatchObject({ part: 0, index: 0, t: 0.4 });
    const hit = nearestSegment(curved, { x: 5, y: 3.2 }, 1)!;
    expect(hit).toMatchObject({ part: 0, index: 0 });
    expect(hit.t).toBeCloseTo(0.5, 2);
    expect(hit.at.y).toBeCloseTo(3, 3);
    expect(nearestSegment(square, { x: 0.2, y: 5 }, 1)).toMatchObject({ index: 3, t: 0.5 });
    expect(nearestSegment(straight, { x: 5, y: 3 }, 1)).toBeUndefined();
  });

  it("en ny punkt på en kurva delar den utan att formen ändras; flaggorna står kvar på slutpunkten", () => {
    const inserted = insertOnSegment(curved, { part: 0, index: 0 }, 0.5)!;
    expect(inserted.address).toEqual({ part: 0, index: 1 });
    const path = pathOf(inserted.object);
    expect(path).toHaveLength(4);
    expect(path[1]).toMatchObject({ type: "C", x: 5, y: 3 });
    // Samma kurva: punkten vid t = 0,25 på originalet ligger på den första halvan (t = 0,5).
    expect(nearestSegment(inserted.object, { x: 2.40625, y: 2.25 }, 0.001)).toBeDefined();
    const line = insertOnSegment(straight, { part: 0, index: 0 }, 0.25)!;
    expect(pathOf(line.object).map(command => [command.type, command.x, command.dash ?? false])).toEqual([["M", 0, false], ["L", 2.5, false], ["L", 10, true]]);
    // Ytans stängande sträcka blir ett eget kommando.
    const area = insertOnSegment(square, { part: 0, index: 3 }, 0.5)!;
    expect(pathOf(area.object).map(command => [command.x, command.y])).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 5], [0, 0]]);
  });

  it("böja en sträcka: kurvan går genom den nya punkten; ändarna står kvar", () => {
    const bent = bendSegment(straight, { part: 0, index: 0 }, 0.5, { x: 0, y: 3 });
    const path = pathOf(bent);
    expect(path[1]).toMatchObject({ type: "C", x: 10, y: 0, dash: true });
    const hit = nearestSegment(bent, { x: 5, y: 3 }, 0.01);
    expect(hit?.t).toBeCloseTo(0.5, 2);
    // Ytans stängande sträcka kan också böjas.
    const area = bendSegment(square, { part: 0, index: 3 }, 0.5, { x: -2, y: 0 });
    expect(pathOf(area)).toHaveLength(5);
    expect(nearestSegment(area, { x: -2, y: 5 }, 0.01)).toBeDefined();
  });

  it("styrpunkterna: en mjuk punkt håller kurvan jämn, ett hörn flyttar bara den ena", () => {
    expect(vertexHandles(curved, { part: 0, index: 1 })).toEqual({ at: { x: 10, y: 0 }, in: { x: 7, y: 4 }, out: { x: 13, y: -4 } });
    const moved = moveHandle(curved, { part: 0, index: 1 }, "in", { x: 6, y: 0 });
    // Den andra styrpunkten åt motsatt håll med samma längd (5 mm).
    expect(vertexHandles(moved, { part: 0, index: 1 })?.out).toEqual({ x: 15, y: 0 });
    const corner: MapObject = { ...curved, path: [curved.path[0]!, { type: "C", x1: 3, y1: 4, x2: 7, y2: 4, x: 10, y: 0 },
      { type: "C", x1: 13, y1: 4, x2: 17, y2: -4, x: 20, y: 0 }] };
    const cornerMoved = moveHandle(corner, { part: 0, index: 1 }, "out", { x: 12, y: 6 });
    expect(vertexHandles(cornerMoved, { part: 0, index: 1 })).toEqual({ at: { x: 10, y: 0 }, in: { x: 7, y: 4 }, out: { x: 12, y: 6 } });
    // En rak sträcka har ingen styrpunkt att dra.
    expect(moveHandle(straight, { part: 0, index: 1 }, "in", { x: 1, y: 1 })).toBe(straight);
  });
});

import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { draftObject, draftPath, insertAt, nearestVertex, rotatePoint, translateObject } from "./map-project-draw";

/** ADR-0219 (K1): ritverktygens geometri (hörn och kurvor som i Mapper, flytta, ny punkt, vrid). */
describe("kartprojektets ritverktyg", () => {
  it("klick ger raka sträckor, en dragning ger en kurva med styrpunkterna en tredjedel ut", () => {
    expect(draftPath([{ at: { x: 0, y: 0 } }, { at: { x: 10, y: 0 } }], false)).toEqual([{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }]);
    const curved = draftPath([{ at: { x: 0, y: 0 }, handle: { x: 6, y: 3 } }, { at: { x: 10, y: 0 } }], false);
    expect(curved[1]).toEqual({ type: "C", x1: 2, y1: 1, x2: 10, y2: 0, x: 10, y: 0 });
  });

  it("en yta stängs; för få punkter ger inget objekt", () => {
    const points = [{ at: { x: 0, y: 0 } }, { at: { x: 10, y: 0 } }, { at: { x: 10, y: 10 } }];
    expect(draftObject("area", "406", points.slice(0, 2))).toBeUndefined();
    expect(draftObject("line", "505", points.slice(0, 1))).toBeUndefined();
    const area = draftObject("area", "406", points);
    expect(area).toMatchObject({ kind: "area", symbol: "406", rings: [[{ type: "M" }, { type: "L" }, { type: "L" }]] });
    // En mjuk sista punkt får en kurva tillbaka till första.
    const smooth = draftObject("area", "406", [...points.slice(0, 2), { at: { x: 10, y: 10 }, handle: { x: -3, y: 0 } }]);
    expect(smooth?.kind === "area" && smooth.rings[0]).toHaveLength(4);
  });

  it("flyttar hela objektet med styrpunkterna och hittar närmaste punkt", () => {
    const line: MapObject = { kind: "line", symbol: "505", path: [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 1, y1: 1, x2: 2, y2: 1, x: 3, y: 0 }] };
    expect(translateObject(line, { x: 1, y: 2 })).toEqual({ kind: "line", symbol: "505",
      path: [{ type: "M", x: 1, y: 2 }, { type: "C", x1: 2, y1: 3, x2: 3, y2: 3, x: 4, y: 2 }] });
    expect(nearestVertex(line, { x: 2.9, y: 0.1 }, 0.5)).toMatchObject({ part: 0, index: 1 });
    expect(nearestVertex(line, { x: 1.5, y: 0 }, 0.5)).toBeUndefined();
  });

  it("lägger en ny punkt där man klickar på en rak sträcka, också ytans stängande sträcka, men inte på en kurva", () => {
    const area: MapObject = { kind: "area", symbol: "406", angle: 0, rings: [[{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 10, y: 10 }]] };
    const inserted = insertAt(area, { x: 4, y: 0.2 }, 0.5);
    expect(inserted?.address).toEqual({ part: 0, index: 1 });
    expect(inserted?.object.kind === "area" && inserted.object.rings[0]![1]).toEqual({ type: "L", x: 4, y: 0 });
    const closing = insertAt(area, { x: 5, y: 5 }, 0.5);
    expect(closing?.address).toEqual({ part: 0, index: 3 });
    const curve: MapObject = { kind: "line", symbol: "505", path: [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 3, y1: 0, x2: 7, y2: 0, x: 10, y: 0 }] };
    expect(insertAt(curve, { x: 5, y: 0 }, 0.5)).toBeUndefined();
  });

  it("vrider punktobjekt (grader moturs, 0–360) men inte linjer", () => {
    const point: MapObject = { kind: "point", symbol: "206", at: { x: 0, y: 0 }, angle: 0 };
    expect(rotatePoint(point, -90)).toMatchObject({ angle: 270 });
    const line: MapObject = { kind: "line", symbol: "505", path: [] };
    expect(rotatePoint(line, 45)).toBe(line);
  });
});

import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { fillOrBorder, measureObject, parallelLine } from "./map-project-shape-tools";

const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]].map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x: x!, y: y! }));
const line: MapObject = { kind: "line", symbol: "s505", path: square };
const area: MapObject = { kind: "area", symbol: "s401", rings: [square], angle: 0 };

describe("formverktygen", () => {
  it("mäter längd och yta i terrängen", () => {
    expect(measureObject(line, 10000)).toEqual({ meters: 400 });
    expect(measureObject(area, 10000)).toEqual({ squareMeters: 10_000 });
    expect(measureObject({ kind: "point", symbol: "x", at: { x: 0, y: 0 }, angle: 0 }, 10000)).toBeUndefined();
  });
  it("fyller en sluten linje och gör kant av en yta, men inte en öppen linje", () => {
    expect(fillOrBorder(line, { id: "s401", kind: "area" })).toEqual([{ kind: "area", symbol: "s401", rings: [square], angle: 0 }]);
    expect(fillOrBorder(area, { id: "s505", kind: "line" })).toEqual([{ kind: "line", symbol: "s505", path: square }]);
    expect(fillOrBorder({ ...line, path: square.slice(0, 3) }, { id: "s401", kind: "area" })).toBeUndefined();
  });
  it("gör en parallell linje", () => {
    const open: MapObject = { kind: "line", symbol: "s505", path: square.slice(0, 2) };
    const parallel = parallelLine(open, 1);
    expect(parallel?.kind === "line" ? parallel.path.map(point => Math.abs(point.y)) : []).toEqual([1, 1]);
  });
});

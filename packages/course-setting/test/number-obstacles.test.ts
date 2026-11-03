/** ADR-0211 beslut 4: numren undviker hus, mörka ytor och svarta linjer; placerade nummer flyttas inte men får en notis. */
import type { MapObject, MapSymbol, ParsedMap, Point } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import {
  applyEdit, checkDocument, computeNumberObstacles, layoutOverprint, NUMBER_OBSTACLE_COST, numberObstaclePoints, obstacleCost, type OverprintPrimitive
} from "../src";
import { lineCourse } from "./build";

const code = (text: string) => ({ text, main: Number(text.split(".")[0]), sub: Number(text.split(".")[1] ?? 0) });
const SYMBOLS: MapSymbol[] = [
  { id: "house", kind: "AREA", code: code("521.0"), name: "Byggnad", hidden: false, fill: 0, hatches: [] },
  { id: "field", kind: "AREA", code: code("401.0"), name: "Öppen mark", hidden: false, fill: 1, hatches: [] },
  { id: "path", kind: "LINE", code: code("505.0"), name: "Stig", hidden: false, strokes: [{ color: 2, width: 0.35 }] }
];
const color = (id: number, r: number, g: number, b: number) => ({ id, name: String(id), rank: id, cmyk: { c: 0, m: 0, y: 0, k: 1 }, rgb: { r, g, b }, opacity: 1 });
const square = (x0: number, y0: number, x1: number, y1: number) =>
  [{ type: "M", x: x0, y: y0 }, { type: "L", x: x1, y: y0 }, { type: "L", x: x1, y: y1 }, { type: "L", x: x0, y: y1 }, { type: "L", x: x0, y: y0 }] as never;
const area = (symbol: string, ...corners: [number, number, number, number]): MapObject => ({ kind: "area", symbol, rings: [square(...corners)], angle: 0 });
const line = (symbol: string, ...points: Point[]): MapObject => ({ kind: "line", symbol, path: points.map((p, i) => ({ type: i === 0 ? "M" : "L", x: p.x, y: p.y })) as never });
const map = (objects: MapObject[]): ParsedMap => ({
  format: "OCD", version: "test", scale: 10000, georeference: null, warnings: [], bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
  // Grå byggnad (mörk nog), gul mark (ljus), svart stig.
  colors: [color(0, 0.35, 0.35, 0.35), color(1, 1, 0.75, 0.2), color(2, 0, 0, 0)], symbols: new Map(SYMBOLS.map(symbol => [symbol.id, symbol])), objects
});
type Text = Extract<OverprintPrimitive, { kind: "text" }>;
const numberOf = (figures: readonly OverprintPrimitive[], ref: string) => figures.find((item): item is Text => item.kind === "text" && item.role === "NUMBER" && item.ref === ref)!;

describe("hindren för numren", () => {
  it("samlar hus, mörka ytor och svarta linjer nära kontrollen, inte ljusa ytor", () => {
    const found = computeNumberObstacles(map([area("house", 2, 1, 8, 6), area("field", -50, -50, 50, 50), line("path", { x: -10, y: -3 }, { x: 10, y: -3 })]),
      [{ id: "c", at: { x: 0, y: 0 } }, { id: "far", at: { x: 90, y: 90 } }]);
    expect(found.c!.areas).toHaveLength(1);
    expect(found.c!.lines).toHaveLength(1);
    expect(found.far).toBeUndefined();
  });

  it("kostnaden: en ruta helt på ett hus kostar som hela ytkostnaden, varje svart linje genom rutan lägger till", () => {
    const obstacles = { areas: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]], lines: [[{ x: -5, y: 20 }, { x: 25, y: 20 }] as const] };
    expect(obstacleCost({ cx: 5, cy: 5, w: 4, h: 3 }, obstacles)).toBeCloseTo(NUMBER_OBSTACLE_COST.area, 6);
    expect(obstacleCost({ cx: 5, cy: 20, w: 4, h: 3 }, obstacles)).toBeCloseTo(NUMBER_OBSTACLE_COST.line, 6);
    expect(obstacleCost({ cx: 30, cy: 30, w: 4, h: 3 }, obstacles)).toBe(0);
    expect(obstacleCost({ cx: 10, cy: 5, w: 4, h: 3 }, obstacles)).toBeGreaterThan(0);
    expect(obstacleCost({ cx: 10, cy: 5, w: 4, h: 3 }, obstacles)).toBeLessThan(NUMBER_OBSTACLE_COST.area);
  });

  it("den automatiska placeringen flyttar numret från huset när det finns plats", () => {
    const { b, course, controls } = lineCourse(1, { mapScale: 10000 });
    const control = b.document.controls[controls[0]!]!;
    const ref = b.cc(course, controls[0]!);
    const before = numberOf(layoutOverprint(b.document, { course }), ref).at;
    // Ett hus precis där numret hamnar utan hinder.
    const house = area("house", before.x - 3, before.y - 3, before.x + 3, before.y + 3);
    const obstacles = computeNumberObstacles(map([house]), numberObstaclePoints(b.document));
    expect(obstacles[control.id]).toBeDefined();
    const after = numberOf(layoutOverprint(b.document, { course, numberObstacles: obstacles }), ref).at;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(1);
    expect(checkDocument(b.document, { numberObstacles: obstacles }).some(check => check.kind === "NUMBER_ON_OBSTACLE")).toBe(false);
  });

  it("ett placerat nummer flyttas inte; Varningar får notisen", () => {
    const { b, course, controls } = lineCourse(1, { mapScale: 10000 });
    const control = b.document.controls[controls[0]!]!;
    const ref = b.cc(course, controls[0]!);
    const at = { x: control.at.x + 5, y: control.at.y + 5 };
    const placed = applyEdit(b.document, { type: "MOVE_NUMBER", course, courseControl: ref, at }).document;
    const obstacles = computeNumberObstacles(map([area("house", at.x - 4, at.y - 4, at.x + 4, at.y + 4)]), numberObstaclePoints(placed));
    expect(numberOf(layoutOverprint(placed, { course, numberObstacles: obstacles }), ref).at).toEqual(at);
    const notice = checkDocument(placed, { numberObstacles: obstacles }).find(check => check.kind === "NUMBER_ON_OBSTACLE");
    expect(notice).toMatchObject({ kind: "NUMBER_ON_OBSTACLE", control: control.id, text: "1" });
  });
});

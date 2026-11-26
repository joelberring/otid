/** Ägaren 2026-11-08: kontrollnumren läggs utanför vägvalsanalysens troliga vägar, i förhandsvisningen och PDF:en. */
import type { Point } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { applyEdit, layoutOverprint, routeHintKey, routeHintOf, routeSegmentsNear, ROUTE_HINT_LIMITS, type OverprintPrimitive } from "../src";
import { lineCourse } from "./build";

type Text = Extract<OverprintPrimitive, { kind: "text" }>;
const numberOf = (figures: readonly OverprintPrimitive[], ref: string) => figures.find((item): item is Text => item.kind === "text" && item.role === "NUMBER" && item.ref === ref)!;

function setup() {
  const { b, course, controls } = lineCourse(1, { mapScale: 10000 });
  const control = b.document.controls[controls[0]!]!;
  const start = Object.values(b.document.controls).find(item => item.kind === "START")!;
  return { b, course, control, start, ref: b.cc(course, controls[0]!) };
}

describe("vägvalens vägar nära kontrollerna", () => {
  it("bara delarna nära kontrollerna sparas, förenklade", () => {
    const route: Point[] = Array.from({ length: 1001 }, (_, i) => ({ x: i / 10, y: Math.sin(i / 100) }));
    const hint = routeHintOf([route])!;
    expect(hint.from).toEqual({ x: 0, y: 0 });
    expect(hint.lines).toHaveLength(2);
    for (const line of hint.lines) for (const point of line) {
      expect(Math.min(Math.hypot(point.x - hint.from.x, point.y - hint.from.y), Math.hypot(point.x - hint.to.x, point.y - hint.to.y)))
        .toBeLessThanOrEqual(ROUTE_HINT_LIMITS.reachMm + 0.01);
    }
    expect(hint.lines.reduce((sum, line) => sum + line.length, 0)).toBeLessThan(100);
  });

  it("numret flyttas från den troliga vägen; en flyttad kontroll gör vägen ogiltig", () => {
    const { b, course, control, start, ref } = setup();
    const before = numberOf(layoutOverprint(b.document, { course }), ref).at;
    // En väg från starten som går rakt genom numrets ruta och vidare förbi kontrollen.
    const through = { x: before.x + (before.x - control.at.x) * 0.2, y: before.y + (before.y - control.at.y) * 0.2 };
    const hint = { from: start.at, to: control.at, lines: [[start.at, through, before, control.at]] };
    const key = routeHintKey(start.at, control.at);
    const document = applyEdit(b.document, { type: "SET_ROUTE_HINTS", hints: { [key]: hint } }).document;
    expect(routeSegmentsNear(document, control.at)).toHaveLength(1);
    const after = numberOf(layoutOverprint(document, { course }), ref).at;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(1);

    const moved = applyEdit(document, { type: "MOVE_CONTROL", control: control.id, at: { x: control.at.x + 3, y: control.at.y } }).document;
    expect(routeSegmentsNear(moved, { x: control.at.x + 3, y: control.at.y })).toHaveLength(0);

    const removed = applyEdit(document, { type: "SET_ROUTE_HINTS", hints: { [key]: null } }).document;
    expect(removed.event.routeHints).toBeUndefined();
  });

  it("fel vägar avvisas", () => {
    const { b } = setup();
    expect(() => applyEdit(b.document, { type: "SET_ROUTE_HINTS", hints: { k: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, lines: [[{ x: 0, y: 0 }]] } } }))
      .toThrow();
    expect(() => applyEdit(b.document, { type: "SET_ROUTE_HINTS", hints: { k: { from: { x: Number.NaN, y: 0 }, to: { x: 1, y: 1 }, lines: [] } } }))
      .toThrow();
  });

  it("routeSegmentsNear med keys slår upp direkt och ignorerar okända/prototypnycklar samt ogiltiga och avlägsna vägar", () => {
    const { b, control, start } = setup();
    const validKey = routeHintKey(start.at, control.at);
    const hints: Record<string, { from: Point; to: Point; lines: Point[][] }> = {
      [validKey]: { from: start.at, to: control.at, lines: [[start.at, { x: control.at.x - 1, y: control.at.y }, control.at]] }
    };
    // Många extra vägar långt bort som inte ska skannas när keys anges.
    for (let i = 0; i < 600; i++) {
      const fx = 500 + i * 2, fy = 500;
      const tx = fx + 10, ty = fy + 10;
      hints[routeHintKey({ x: fx, y: fy }, { x: tx, y: ty })] = { from: { x: fx, y: fy }, to: { x: tx, y: ty }, lines: [[{ x: fx, y: fy }, { x: tx, y: ty }]] };
    }
    const document = applyEdit(b.document, { type: "SET_ROUTE_HINTS", hints }).document;
    const keys = new Set([validKey, "saknas", "toString", "constructor"]);
    const withKeys = routeSegmentsNear(document, control.at, ROUTE_HINT_LIMITS.reachMm, keys);
    const withoutKeys = routeSegmentsNear(document, control.at, ROUTE_HINT_LIMITS.reachMm);
    expect(withKeys).toEqual(withoutKeys);
    expect(withKeys).toHaveLength(1);
    expect(routeSegmentsNear(document, control.at, ROUTE_HINT_LIMITS.reachMm, new Set(["toString", "saknas"]))).toEqual([]);
  });
});

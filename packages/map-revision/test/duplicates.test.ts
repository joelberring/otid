import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { duplicatePlan, type DuplicateRow } from "../src";

const ring = (points: readonly [number, number][]) => points.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y }));
const square = (x: number, y: number, side: number): [number, number][] => [[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]];
const area = (key: string, code: string, points: [number, number][]): DuplicateRow => ({ key, code, object: { kind: "area", symbol: `s${code}`, rings: [ring(points)], angle: 0 } });
const line = (key: string, code: string, points: [number, number][]): DuplicateRow => ({ key, code, object: { kind: "line", symbol: `s${code}`, path: ring(points) } as MapObject });

describe("dubbletter (ägaren 2026-11-23: «mörkgröna ytor ligger trippelt»)", () => {
  it("samma yta i 406, 408 och 410 (grundkartans kapslade grönt): bara 410 står kvar", () => {
    const plan = duplicatePlan([area("a", "406", square(0, 0, 10)), area("b", "408", square(0, 0, 10)), area("c", "410", square(0, 0, 10))]);
    expect(plan.remove).toEqual(["a", "b"]);
    expect(plan.bySymbol).toEqual({ "406": 1, "408": 1 });
  });

  it("406 med en bred ljus kant runt 408 står kvar", () => {
    expect(duplicatePlan([area("a", "406", square(0, 0, 20)), area("b", "408", square(5, 5, 10))]).remove).toEqual([]);
  });

  it("samma symbol: identiska och ≥ 90 % överlappande ytor tas bort (den största står kvar), grannar inte", () => {
    const plan = duplicatePlan([area("a", "401", square(0, 0, 10)), area("b", "401", square(0, 0, 10)), area("c", "401", square(0.2, 0, 10)),
      area("d", "401", square(10, 0, 10)), area("e", "403", square(0, 0, 10))]);
    expect(plan.remove.length).toBe(2);
    expect(plan.remove).not.toContain("d");
    expect(plan.remove).not.toContain("e");
  });

  it("linjer och punkter med samma symbol på samma ställe", () => {
    const plan = duplicatePlan([line("a", "501.1", [[0, 0], [10, 0], [10, 5]]), line("b", "501.1", [[10, 5], [10, 0.05], [0, 0.05]]),
      line("c", "501.1", [[0, 1], [10, 1]]), line("d", "501.1", [[0, 0], [5, 0]]),
      { key: "p", code: "418", object: { kind: "point", symbol: "t", at: { x: 1, y: 1 }, angle: 0 } as MapObject },
      { key: "q", code: "418", object: { kind: "point", symbol: "t", at: { x: 1.01, y: 1 }, angle: 0 } as MapObject }]);
    expect(plan.remove.filter(key => ["a", "b"].includes(key))).toHaveLength(1);
    expect(plan.remove).not.toContain("c");
    expect(plan.remove).not.toContain("d");
    expect(plan.remove.filter(key => ["p", "q"].includes(key))).toHaveLength(1);
  });
});

import type { PathCommand } from "@o-tid/map-file";
import { maxOf, minOf } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { combineGeneralize, coveredObjects, generalize, generalizeJoins, generalizePart, generalizeParts, type NormObject, type ObjectKey } from "../src";

/** Ägaren 2026-11-15: generaliseringen ruta för ruta och underlag som redan är ritat. */
const path = (points: readonly [number, number][]): PathCommand[] => points.map(([x, y], i) => ({ type: i === 0 ? "M" : "L", x, y }));
const line = (key: string, symbol: string, points: readonly [number, number][]): NormObject => ({ key, code: symbol, object: { kind: "line", symbol, path: path(points) } });

describe("generaliseringen i delar", () => {
  // Täta linjer över ett stort område, en kedja som går genom flera rutor och en kort linje.
  const dense = (key: string, y: number) => line(key, "506", Array.from({ length: 200 }, (_, i) => [i, y + (i % 2) * 0.001] as [number, number]));
  const objects: NormObject[] = [
    dense("b:1", 10), dense("b:2", 100), dense("b:3", 170),
    line("b:4", "101", [[0, 50], [70, 50]]), line("b:5", "101", [[70, 50], [140, 50]]), line("b:6", "101", [[140, 50], [190, 50]]),
    line("b:7", "516", [[30, 30], [30.1, 30]])
  ];
  const options = { simplifyMm: 0.1, removeSmall: true, joinLines: true, removeInside: true };

  it("ger samma ändringar som hela kartan på en gång, och inget objekt får två", () => {
    const parts = generalizeParts(objects, {});
    expect(parts.length).toBeGreaterThan(4);
    const taken = new Set<ObjectKey>();
    const combined = combineGeneralize([generalizeJoins(objects, 4000, options, taken), ...parts.map(part => generalizePart(part, 4000, options, taken))]);
    const whole = generalize(objects, 4000, options);
    const keys = combined.changes.map(change => change.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(whole.changes.map(change => change.key).sort());
    expect(combined.joined).toEqual({ lines: 1, absorbed: 2 });
    expect(combined.simplified).toBe(whole.simplified);
  });

  it("delar bara upp rutan inom ett delområde", () => {
    const parts = generalizeParts(objects, { within: { minX: 0, minY: 0, maxX: 50, maxY: 50 } });
    expect(parts.every(part => part.box.maxX <= 50 && part.box.maxY <= 50)).toBe(true);
  });
});

describe("minOf och maxOf", () => {
  it("klarar listor som är för långa för Math.min(...lista)", () => {
    const values = Array.from({ length: 300_000 }, (_, i) => Math.sin(i) * i);
    expect(minOf(values)).toBe(values.reduce((a, b) => Math.min(a, b)));
    expect(maxOf(values)).toBe(values.reduce((a, b) => Math.max(a, b)));
  });
});

describe("underlag som redan är ritat", () => {
  it("räknar ett underlag som täckt när det mesta ligger inom toleransen från målsymbolens objekt", () => {
    const target = [line("t", "501.1", [[0, 0], [100, 0]]).object];
    const sources = [line("a", "990", [[0, 0.2], [100, 0.2]]).object, line("b", "990", [[0, 5], [100, 5]]).object,
      line("c", "990", [[50, 0.1], [150, 0.1]]).object];
    expect([...coveredObjects(sources, target, 0.375)]).toEqual([0]);
    expect(coveredObjects(sources, [], 0.375).size).toBe(0);
  });
});

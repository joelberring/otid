import { describe, expect, it } from "vitest";
import type { MapObject, PathCommand } from "@o-tid/map-file";
import { checkNorm, normScale, type NormObject } from "../src";

/** Normkontrollen: ISOM 2017-2:s minimimått (grundskalan 1:15 000, ×1,5 för 1:10 000). */
const path = (points: [number, number][]): PathCommand[] => points.map(([x, y], index) => ({ type: index === 0 ? "M" : "L", x, y }));
const line = (key: string, code: string, points: [number, number][]): NormObject =>
  ({ key: `n:${key}`, code, object: { kind: "line", symbol: code, path: path(points) } as MapObject });
const area = (key: string, code: string, points: [number, number][]): NormObject =>
  ({ key: `n:${key}`, code, object: { kind: "area", symbol: code, rings: [path(points)], angle: 0 } as MapObject });
const rules = (objects: NormObject[], scale = 15000) => checkNorm(objects, scale).issues.map(issue => [issue.rule, issue.key]);

describe("normkontrollen", () => {
  it("skalan: ISOM 1:15 000 och 1:10 000, sprint", () => {
    expect(normScale(15000)).toEqual({ standard: "ISOM", factor: 1 });
    expect(normScale(10000)).toEqual({ standard: "ISOM", factor: 1.5 });
    expect(normScale(4000)).toEqual({ standard: "ISSPROM", factor: 1 });
  });

  it("kurvor för nära varandra (0,15 mm mellan konturerna)", () => {
    // Två kurvor (0,14 mm) 0,25 mm isär mitt till mitt: konturerna 0,11 mm isär → fel; 0,3 mm isär → rätt.
    const close = [line("a", "101.0", [[0, 0], [10, 0]]), line("b", "101.0", [[0, 0.25], [10, 0.25]])];
    const result = checkNorm(close, 15000);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every(issue => issue.rule === "CONTOUR_GAP" && issue.limit > 0.28 && issue.limit < 0.3)).toBe(true);
    // Ett fel per millimeter längs kurvorna.
    expect(result.issues.length).toBeLessThanOrEqual(11);
    expect(rules([line("a", "101.0", [[0, 0], [10, 0]]), line("b", "101.0", [[0, 0.3], [10, 0.3]])])).toEqual([]);
    // På 1:10 000 är gränsen 1,5 gånger större.
    expect(rules([line("a", "101.0", [[0, 0], [10, 0]]), line("b", "101.0", [[0, 0.4], [10, 0.4]])], 10000).length).toBeGreaterThan(0);
    // Stödkurvan och en vanlig kurva som korsar varandra.
    expect(rules([line("a", "103.0", [[0, 0], [10, 0]]), line("b", "101.0", [[5, -5], [5, 5]])])).toEqual([["CONTOUR_GAP", "n:a"]]);
  });

  it("korta fristående linjer, men inte delar av ett nät", () => {
    expect(rules([line("stig", "505.0", [[0, 0], [3, 0]])])).toEqual([["SHORT_LINE", "n:stig"]]);
    expect(rules([line("stig", "505.0", [[0, 0], [3, 0]]), line("lang", "505.0", [[3, 0], [20, 0]])])).toEqual([]);
    expect(rules([line("mur", "513.1", [[0, 0], [1.5, 0]])])).toEqual([]);
  });

  it("små och smala ytor, små kullar", () => {
    expect(rules([area("hus", "521.0", [[0, 0], [0.4, 0], [0.4, 0.4], [0, 0.4]])])).toEqual([["SMALL_AREA", "n:hus"]]);
    expect(rules([area("hus", "521.0", [[0, 0], [0.6, 0], [0.6, 0.6], [0, 0.6]])])).toEqual([]);
    expect(rules([area("snar", "408.0", [[0, 0], [20, 0], [20, 0.1], [0, 0.1]])])).toEqual([["THIN_AREA", "n:snar"]]);
    expect(rules([line("kulle", "101.0", [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5], [0, 0]])])).toEqual([["SMALL_CLOSED", "n:kulle"]]);
    expect(rules([line("kulle", "101.0", [[0, 0], [1, 0], [1, 0.7], [0, 0.7], [0, 0]])])).toEqual([]);
  });
});

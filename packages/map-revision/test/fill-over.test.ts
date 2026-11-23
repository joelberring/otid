import { describe, expect, it } from "vitest";
import type { MapObject, Path } from "@o-tid/map-file";
import { areaMinimum, fillOverCuts, isGroundArea } from "../src";

/** K8b V7 Fyll över (ägaren 2026-11-23). */
const square = (x: number, y: number, w: number, h = w): Path => [{ type: "M", x, y }, { type: "L", x: x + w, y }, { type: "L", x: x + w, y: y + h }, { type: "L", x, y: y + h }];
const area = (symbol: string, x: number, y: number, w: number, h = w) => ({ kind: "area", symbol, angle: 0, rings: [square(x, y, w, h)] }) as Extract<MapObject, { kind: "area" }>;
const cell = [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]];
const xs = (object: MapObject) => object.kind === "area" ? object.rings[0]!.map(point => point.x) : [];

describe("Fyll över", () => {
  it("markytor och hårda ytor per norm", () => {
    for (const norm of ["ISOM", "ISSPROM", "ISSOM"] as const) {
      for (const code of ["403", "406", "213", "214", "308", "310"]) expect(isGroundArea(code, norm)).toBe(true);
      for (const code of ["301", "302", "307", "202", "206", "521", "522", "526", "990"]) expect(isGroundArea(code, norm)).toBe(false);
    }
    expect(isGroundArea("501.3", "ISSPROM")).toBe(true);
    expect(isGroundArea("520", "ISSPROM")).toBe(true);
    expect(isGroundArea("529", "ISSOM")).toBe(true);
    expect(isGroundArea("421", "ISSOM")).toBe(false);
    expect(isGroundArea("411", "ISSPROM")).toBe(false);
    expect(isGroundArea("411", "ISOM")).toBe(false);
    expect(areaMinimum("520", 4000)).toBeCloseTo(0.25, 6);
    expect(areaMinimum("404", 10000)).toBeCloseTo(6.25 * 2.25, 6);
  });

  it("tar bort en helt täckt yta, beskär en delvis täckt, tar bort en för liten restbit och lämnar ytor utanför", () => {
    const targets = [area("403", 4, 4, 2), area("520", -5, 2, 10, 6), area("520", -0.05, 9, 3.05, 0.5), area("406", 20, 20, 5)]
      .map(object => ({ object, minPieceMm2: 0.25 }));
    const cuts = fillOverCuts(cell, targets, 0.001);
    expect(cuts.map(cut => [cut.target, cut.pieces.length])).toEqual([[0, 0], [1, 1], [2, 0]]);
    const kept = cuts[1]!.pieces[0]!;
    expect(Math.max(...xs(kept))).toBeCloseTo(0, 6);
    expect(Math.min(...xs(kept))).toBeCloseTo(-5, 6);
    expect(kept.symbol).toBe("520");
    // Skärningen (det som tas bort) för förhandsvisningen.
    expect(cuts[0]!.removed).toHaveLength(1);
  });

  it("en yta som delas i två blir två delar, och en yta som redan täcker hela rutan märks", () => {
    const cuts = fillOverCuts(cell, [{ object: area("403", -5, 4, 20, 2), minPieceMm2: 0.25 }, { object: area("520", -1, -1, 12), minPieceMm2: 0.25, cover: true }], 0.001);
    expect(cuts[0]!.pieces).toHaveLength(2);
    expect(cuts[0]!.covers).toBe(false);
    expect(cuts[1]!.covers).toBe(true);
    // Ytan 12 × 12 med rutan 10 × 10 bortklippt: en ring med ett hål.
    expect(cuts[1]!.pieces[0]!.rings).toHaveLength(2);
  });
});

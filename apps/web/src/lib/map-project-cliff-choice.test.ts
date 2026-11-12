import { describe, expect, it } from "vitest";
import { cliffFeatures, DEFAULT_CLIFF_LIMITS, readCliffCandidates } from "./map-project-cliff-choice";

const feature = (drop3: number, drop6: number, length: number) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [length, 0]] },
  properties: { drop3, drop6, length } });
const candidates = readCliffCandidates({ features: [feature(1, 1.2, 15), feature(2, 2.5, 12), feature(5, 6, 25), feature(5, 6, 12), feature(1.5, 2, 5),
  { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} }] });

describe("branter med reglage", () => {
  it("läser linjerna med sina mått", () => { expect(candidates).toHaveLength(5); });
  it("delar med förvalen: under 1,3 m ingen brant, högt och långt opasserbart, resten passerbart", () => {
    const result = cliffFeatures(candidates, DEFAULT_CLIFF_LIMITS);
    expect([result.impassable, result.passable]).toEqual([1, 3]);
    expect(result.features.map(row => row.layer)).toEqual(["brant_passerbar", "brant_opasserbar", "brant_passerbar", "brant_passerbar"]);
  });
  it("tar bort de för korta och ger taggar när det är valt", () => {
    const result = cliffFeatures(candidates, { ...DEFAULT_CLIFF_LIMITS, minDrop: 0.8, impassableLength: 10, tags: true }, 9);
    expect([result.impassable, result.passable]).toEqual([2, 2]);
    expect(new Set(result.features.map(row => row.layer))).toEqual(new Set(["brant_opasserbar", "brant_passerbar_taggar"]));
  });
});

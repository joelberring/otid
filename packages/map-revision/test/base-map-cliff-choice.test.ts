import { describe, expect, it } from "vitest";
import { cliffFeatures, cliffLimitsAt, defaultCliffLimits, readCliffCandidates } from "../src/base-map/cliff-choice";

const DEFAULT_CLIFF_LIMITS = { ...defaultCliffLimits(10_000), minLength: 0 };

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
    const result = cliffFeatures(candidates, { ...DEFAULT_CLIFF_LIMITS, minDrop: 0.8, impassableLength: 10, tags: true, minLength: 9 });
    expect([result.impassable, result.passable]).toEqual([2, 2]);
    expect(new Set(result.features.map(row => row.layer))).toEqual(new Set(["brant_opasserbar", "brant_passerbar_taggar"]));
  });
});

describe("mängden branter på skalan 1–10", () => {
  it("går över både fallet och längden, med förvalen på 5", () => {
    const usual = defaultCliffLimits(15_000);
    expect(usual.minLength).toBe(9);
    expect(cliffLimitsAt(5, usual, 15_000)).toEqual(usual);
    expect(cliffLimitsAt(1, usual, 15_000)).toMatchObject({ minDrop: 5.5, minLength: 30, impassableDrop: 4.5 });
    expect(cliffLimitsAt(10, { ...usual, tags: true }, 15_000)).toMatchObject({ minDrop: 0.8, minLength: 0, tags: true });
    expect(cliffLimitsAt(3, usual, 15_000)).toMatchObject({ minDrop: 3.4, minLength: 19.5 });
  });
});

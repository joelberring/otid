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
  it("går över både fallet och längden, med skalanpassade förval på 5 (skog vs sprint)", () => {
    const usual = defaultCliffLimits(15_000);
    expect(usual).toEqual({ minDrop: 1.3, impassableDrop: 4.0, impassableLength: 16, impassableSlope: 40, tags: false, minLength: 9 });
    expect(cliffLimitsAt(5, usual, 15_000)).toEqual(usual);
    expect(cliffLimitsAt(1, usual, 15_000)).toMatchObject({ minDrop: 5.5, minLength: 30, impassableDrop: 4.0, impassableSlope: 40 });
    expect(cliffLimitsAt(10, { ...usual, tags: true }, 15_000)).toMatchObject({ minDrop: 0.8, minLength: 0, tags: true });
    expect(cliffLimitsAt(3, usual, 15_000)).toMatchObject({ minDrop: 3.4, minLength: 19.5 });

    // Sprint (<= 1:5 000): lägre fall och kortare längd för 201 opasserbar brant.
    const sprint = defaultCliffLimits(4_000);
    expect(sprint).toEqual({ minDrop: 1.3, impassableDrop: 3.0, impassableLength: 8, impassableSlope: 39, tags: false, minLength: 2.4 });
    expect(cliffLimitsAt(5, sprint, 4_000)).toEqual(sprint);
    expect(cliffLimitsAt(1, sprint, 4_000)).toMatchObject({ minDrop: 4.0, minLength: 16, impassableDrop: 3.0, impassableLength: 8 });
  });

  it("hanterar drop6: null (kantbrant) och valfri slope/sharpness bakåtkompatibelt", () => {
    const parsed = readCliffCandidates({
      features: [
        // Kantbrant utan ±6 m-höjdpar: blir passerbar (202), aldrig krasch eller opasserbar.
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [20, 0]] }, properties: { drop3: 4.5, drop6: null, length: 20 } },
        // Brant med hög drop men för flack medianlutning (37° < 39° på sprint): blir passerbar (202).
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 10], [10, 10]] }, properties: { drop3: 3.4, drop6: 4.2, length: 10, slope: 37.0, sharpness: 0.81 } },
        // Skarp sprintklippa (42° >= 39°, 3.4 m, 10 m >= 8 m): blir opasserbar (201).
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 20], [10, 20]] }, properties: { drop3: 3.4, drop6: 3.8, length: 10, slope: 42.0, sharpness: 0.89 } }
      ]
    });
    expect(parsed).toHaveLength(3);
    expect(Number.isNaN(parsed[0]!.drop6)).toBe(true);
    expect(parsed[2]).toMatchObject({ slope: 42.0, sharpness: 0.89 });
    const sprintRes = cliffFeatures(parsed, defaultCliffLimits(4_000));
    expect([sprintRes.impassable, sprintRes.passable]).toEqual([1, 2]);
    expect(sprintRes.features.map(f => f.layer)).toEqual(["brant_passerbar", "brant_passerbar", "brant_opasserbar"]);
  });
});

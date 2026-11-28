import { describe, expect, it } from "vitest";
import { cliffFeatures, cliffLimitsAt, defaultCliffLimits, readCliffCandidates } from "../src/base-map/cliff-choice";

const DEFAULT_CLIFF_LIMITS = { ...defaultCliffLimits(10_000), minLength: 0 };

const feature = (drop3: number, drop6: number, length: number) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [length, 0]] },
  properties: { drop3, drop6, length } });
const candidates = readCliffCandidates({ features: [feature(1, 1.2, 15), feature(2, 2.5, 12), feature(5, 6, 25), feature(5, 6, 12), feature(1.5, 2, 5),
  { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} }] });

describe("branter med reglage", () => {
  it("läser linjerna med sina mått", () => { expect(candidates).toHaveLength(5); });
  it("delar med förvalen: under 2,0 m ingen brant, högt och långt opasserbart, resten passerbart", () => {
    const result = cliffFeatures(candidates, DEFAULT_CLIFF_LIMITS);
    expect([result.impassable, result.passable]).toEqual([1, 2]);
    expect(result.features.map(row => row.layer)).toEqual(["brant_passerbar", "brant_opasserbar", "brant_passerbar"]);
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
    expect(usual).toEqual({ minDrop: 2.0, minSlope: 39, impassableDrop: 4.1, impassableLength: 16, impassableSlope: 41, minSharpness: 0.56, tags: false, minLength: 9 });
    expect(cliffLimitsAt(5, usual, 15_000)).toEqual(usual);
    expect(cliffLimitsAt(1, usual, 15_000)).toMatchObject({ minDrop: 5.5, minLength: 30, impassableDrop: 4.1, impassableSlope: 41 });
    expect(cliffLimitsAt(10, { ...usual, tags: true }, 15_000)).toMatchObject({ minDrop: 0.8, minLength: 0, tags: true });
    expect(cliffLimitsAt(3, usual, 15_000)).toMatchObject({ minDrop: 3.75, minLength: 19.5 });

    // Sprint (<= 1:5 000): kalibrerad 201/202-uppdelning (minDrop 1,2 m, 201 från 3,4 m / 10 m / 40°).
    const sprint = defaultCliffLimits(4_000);
    expect(sprint).toEqual({ minDrop: 1.2, impassableDrop: 3.4, impassableLength: 10, impassableSlope: 40, minSharpness: 0.58, tags: false, minLength: 2.4 });
    expect(cliffLimitsAt(5, sprint, 4_000)).toEqual(sprint);
    expect(cliffLimitsAt(1, sprint, 4_000)).toMatchObject({ minDrop: 4.0, minLength: 16, impassableDrop: 3.4, impassableLength: 10 });
  });

  it("hanterar drop6: null (kantbrant), brantkantsskärpa (sharpness), 46°-undantag och sprint-201/202-split", () => {
    const parsed = readCliffCandidates({
      features: [
        // Kantbrant utan ±6 m-höjdpar (och utan sharpness/slope): bakåtkompatibelt passerbar (202), aldrig opasserbar.
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [20, 0]] }, properties: { drop3: 4.5, drop6: null, length: 20 } },
        // Jämn vägslänt / talus (sharpness 0,48 < 0,58, lutning 40° < 46°): sorteras bort.
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 5], [20, 5]] }, properties: { drop3: 4.4, drop6: 9.2, length: 20, slope: 40.0, sharpness: 0.48 } },
        // Riktig brant bergvägg (sharpness 0,52 < 0,58, men lutning 47° >= 46°): kringgår skärpespärren -> opasserbar (201).
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 8], [20, 8]] }, properties: { drop3: 5.0, drop6: 9.6, length: 20, slope: 47.0, sharpness: 0.52 } },
        // Medelhög sprintklippa (3,1 m < 3,4 m, 9 m < 10 m, 39° < 40°, sharpness 0,82): blir passerbar (202) i stället för 201.
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 10], [9, 10]] }, properties: { drop3: 3.1, drop6: 3.8, length: 9, slope: 39.0, sharpness: 0.82 } },
        // Hög och lång sprintklippa (3,6 m >= 3,4 m, 12 m >= 10 m, 42° >= 40°, sharpness 0,86): blir opasserbar (201).
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 20], [12, 20]] }, properties: { drop3: 3.6, drop6: 4.2, length: 12, slope: 42.0, sharpness: 0.86 } }
      ]
    });
    expect(parsed).toHaveLength(5);
    expect(Number.isNaN(parsed[0]!.drop6)).toBe(true);
    expect(parsed[4]).toMatchObject({ slope: 42.0, sharpness: 0.86 });
    const sprintRes = cliffFeatures(parsed, defaultCliffLimits(4_000));
    expect([sprintRes.impassable, sprintRes.passable]).toEqual([2, 2]);
    expect(sprintRes.features.map(f => f.layer)).toEqual(["brant_passerbar", "brant_opasserbar", "brant_passerbar", "brant_opasserbar"]);

    // I skog (1:15 000) sorteras dessutom flacka sluttningar under 39° och vägslänter (sharpness < 0,56) bort.
    const forestCandidates = readCliffCandidates({
      features: [
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [15, 0]] }, properties: { drop3: 2.5, drop6: 3.5, length: 15, slope: 37.5, sharpness: 0.71 } },
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 10], [15, 10]] }, properties: { drop3: 2.5, drop6: 5.0, length: 15, slope: 41.0, sharpness: 0.50 } },
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 20], [15, 20]] }, properties: { drop3: 2.5, drop6: 3.3, length: 15, slope: 41.0, sharpness: 0.76 } }
      ]
    });
    const forestRes = cliffFeatures(forestCandidates, defaultCliffLimits(15_000));
    expect([forestRes.impassable, forestRes.passable]).toEqual([0, 1]);
  });
});

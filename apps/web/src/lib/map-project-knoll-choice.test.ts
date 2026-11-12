import { describe, expect, it } from "vitest";
import { chooseKnolls, DEFAULT_KNOLL_LIMITS, knollFeatures, readKnollCandidates } from "./map-project-knoll-choice";

const json = { type: "FeatureCollection", features: [
  { type: "Feature", geometry: { type: "Point", coordinates: [100, 100] }, properties: { rise: 1.4, share: 0.9, foot: 40 } },
  { type: "Feature", geometry: { type: "Point", coordinates: [104, 100] }, properties: { rise: 2.0, share: 0.85, foot: 60 } },
  { type: "Feature", geometry: { type: "Point", coordinates: [200, 100] }, properties: { rise: 0.7, share: 0.95, foot: 30 } },
  { type: "Feature", geometry: { type: "Point", coordinates: [300, 100] }, properties: { rise: 1.6, share: 0.6, foot: 30 } },
  { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: {} }
] };

describe("punkthöjder med reglage", () => {
  const candidates = readKnollCandidates(json);
  it("läser kandidaterna och hoppar över annat", () => {
    expect(candidates).toHaveLength(4);
    expect(readKnollCandidates(null)).toEqual([]);
  });
  it("väljer med förvalen: den högsta av två nära varandra, inte de låga eller de på en sluttning", () => {
    expect(chooseKnolls(candidates, DEFAULT_KNOLL_LIMITS)).toEqual([[104, 100]]);
  });
  it("släpper in fler med lägre gränser och glesar ut med större avstånd", () => {
    expect(chooseKnolls(candidates, { minRise: 0.5, lowerShare: 0.5, maxFootM2: 160, spacing: 10 })).toHaveLength(3);
    expect(chooseKnolls(candidates, { minRise: 0.5, lowerShare: 0.5, maxFootM2: 160, spacing: 150 })).toEqual([[104, 100], [300, 100]]);
  });
  it("ger kandidater i lagret för små kullar", () => {
    expect(knollFeatures([[1, 2]])).toEqual([{ layer: "dotknoll_laser", geometry: { kind: "point", at: [1, 2] } }]);
  });
});

describe("mängden på skalan 1–10", () => {
  it("ger förvalen på 5, bara de tydligaste på 1 och allt på 10", async () => {
    const { knollLimitsAt } = await import("./map-project-knoll-choice");
    expect(knollLimitsAt(5)).toEqual(DEFAULT_KNOLL_LIMITS);
    expect(knollLimitsAt(1)).toEqual({ minRise: 2, lowerShare: 0.95, maxFootM2: 80, spacing: 40 });
    expect(knollLimitsAt(10)).toEqual({ minRise: 0.5, lowerShare: 0.5, maxFootM2: 160, spacing: 10 });
    expect(knollLimitsAt(3).minRise).toBe(1.5);
  });
});

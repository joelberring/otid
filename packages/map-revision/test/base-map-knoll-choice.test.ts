import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { chooseKnollCandidates, chooseKnolls, deduplicateKnollFeatures, DEFAULT_KNOLL_LIMITS, knollFeatures, readKnollCandidates } from "../src/base-map/knoll-choice";
import { elongatedKnoll } from "../src/base-map/elongated-knolls";

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
    const { knollLimitsAt } = await import("../src/base-map/knoll-choice");
    expect(knollLimitsAt(5)).toEqual(DEFAULT_KNOLL_LIMITS);
    expect(knollLimitsAt(1)).toEqual({ minRise: 2, lowerShare: 0.95, maxFootM2: 70, spacing: 40 });
    expect(knollLimitsAt(10)).toEqual({ minRise: 0.5, lowerShare: 0.5, maxFootM2: 160, spacing: 10 });
    expect(knollLimitsAt(3).minRise).toBe(1.45);
    // Kalibrerat mot 5 skogskartor + Bandhagen (F1 0,279 → 0,371 på 4 oberoende facitkartor, recall +70 %):
    // 0,9 m stigning, 85 % lägre ring, kompakt fot 8–70 m², 12 m avstånd.
    expect(DEFAULT_KNOLL_LIMITS).toEqual({ minRise: 0.9, lowerShare: 0.85, maxFootM2: 70, spacing: 12 });
  });
  it("rensar mikroskopiska laserbrus-toppar (< 8 m² fot) men behåller skarpa riktiga kullar", () => {
    const items = [
      { at: [0, 0] as [number, number], rise: 1.5, share: 0.95, footM2: 4 },
      { at: [50, 0] as [number, number], rise: 0.95, share: 0.88, footM2: 14 },
      { at: [100, 0] as [number, number], rise: 1.1, share: 0.9, footM2: 78 }
    ];
    expect(chooseKnolls(items, DEFAULT_KNOLL_LIMITS)).toEqual([[50, 0]]);
  });
});

describe("kullar i sankmark", () => {
  it("tas bara med när de är uppenbara (minst 1,5 m)", () => {
    const marsh = [{ at: [0, 0] as [number, number], rise: 1.2, share: 0.9, footM2: 40, wet: true }, { at: [50, 0] as [number, number], rise: 1.7, share: 0.9, footM2: 40, wet: true },
      { at: [100, 0] as [number, number], rise: 1.2, share: 0.9, footM2: 40 }];
    expect(chooseKnolls(marsh, DEFAULT_KNOLL_LIMITS)).toEqual([[50, 0], [100, 0]]);
    expect(readKnollCandidates({ features: [{ geometry: { type: "Point", coordinates: [1, 2] }, properties: { rise: 1, share: 1, foot: 30, wet: 1 } }] })[0]!.wet).toBe(true);
  });
});

describe("formklassade kullar (aspect/angle -> 109/110) och 6 m avdubblettering", () => {
  it("läser valfria aspect/angle och skapar dotknoll_avlang med rätt vinkel när aspect >= 1,65 och fot >= 18 m²", () => {
    const shaped = readKnollCandidates({
      type: "FeatureCollection",
      features: [
        // Avlång kulle (aspect 2.1, fot 32 m², vinkel 90° -> nord-sydlig)
        { type: "Feature", geometry: { type: "Point", coordinates: [100, 200] }, properties: { rise: 1.4, share: 0.9, foot: 32, aspect: 2.1, angle: 90 } },
        // Rund kulle (aspect 1.3 < 1.65)
        { type: "Feature", geometry: { type: "Point", coordinates: [150, 200] }, properties: { rise: 1.3, share: 0.9, foot: 30, aspect: 1.3, angle: 45 } },
        // För liten fot (14 < 18 m²) trots hög aspect -> förblir rund 109
        { type: "Feature", geometry: { type: "Point", coordinates: [200, 200] }, properties: { rise: 1.2, share: 0.9, foot: 14, aspect: 2.0, angle: 30 } }
      ]
    });
    expect(shaped[0]).toMatchObject({ aspect: 2.1, angle: 90 });
    const chosen = chooseKnollCandidates(shaped, DEFAULT_KNOLL_LIMITS);
    const features = knollFeatures(chosen);
    expect(features.map(f => f.layer)).toEqual(["dotknoll_avlang", "dotknoll_laser", "dotknoll_laser"]);
    expect(features[0]).toEqual(elongatedKnoll([100, 200], Math.PI / 2));
  });

  it("avdubbletterar inkommande kullar inom 6 m mot kvarvarande 109/110 samt inuti små slutna 101-toppringar", () => {
    const circle = (cx: number, cy: number, r: number): [number, number][] =>
      Array.from({ length: 16 }, (_, i) => [cx + r * Math.cos(i * Math.PI / 8), cy + r * Math.sin(i * Math.PI / 8)]);
    const existing: SourceFeature[] = [
      { layer: "dotknoll_avlang", geometry: { kind: "point", at: [100, 100] } },
      { layer: "contour", geometry: { kind: "line", closed: true, points: circle(300, 100, 12) } }
    ];
    const incoming: SourceFeature[] = [
      { layer: "dotknoll_laser", geometry: { kind: "point", at: [106, 100] } }, // exakt 6 m -> bort
      { layer: "dotknoll_laser", geometry: { kind: "point", at: [106.5, 100] } }, // > 6 m -> kvar
      { layer: "dotknoll_laser", geometry: { kind: "point", at: [300, 100] } }, // inuti 101-toppring (< 3000 m²) -> bort
      { layer: "dotknoll_laser", geometry: { kind: "point", at: [400, 100] } }
    ];
    const deduped = deduplicateKnollFeatures(incoming, existing);
    expect(deduped.map(f => (f.geometry as { at: readonly [number, number] }).at)).toEqual([[106.5, 100], [400, 100]]);
    // I sprint (1:4 000) har r=12 m yta ~440 m² (> ~213 m²), så punkthöjden på den större sprintkullen bevaras.
    const sprintDeduped = deduplicateKnollFeatures(incoming, existing, 6, 215);
    expect(sprintDeduped.map(f => (f.geometry as { at: readonly [number, number] }).at)).toEqual([[106.5, 100], [300, 100], [400, 100]]);
  });
});

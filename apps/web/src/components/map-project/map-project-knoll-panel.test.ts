import { describe, expect, it } from "vitest";
import type { SourceData, SourceFeature } from "@o-tid/map-revision";
import { chooseKnollCandidates, DEFAULT_KNOLL_LIMITS, knollFeatures, type KnollCandidate } from "@o-tid/map-revision/base-map";
import { knollOwnPattern } from "./map-project-knoll-panel";
import { mergeRefinedCandidates } from "./use-map-project-import";

describe("webbläsarens knollreglage (109/110 utan dubbletter)", () => {
  it("ersätter både 109 och 110 när kullar.geojson har aspect/angle men behåller gropar och undviker dubbletter", () => {
    const candidates: KnollCandidate[] = [
      { at: [100, 100], rise: 1.4, share: 0.9, footM2: 30, aspect: 2.1, angle: 45 },
      { at: [140, 100], rise: 1.2, share: 0.9, footM2: 20, aspect: 1.15, angle: 0 }
    ];
    const own = knollOwnPattern(candidates);
    expect(own.test("dotknoll")).toBe(true);
    expect(own.test("dotknoll_laser")).toBe(true);
    expect(own.test("dotknoll_avlang")).toBe(true);
    expect(own.test("udepression")).toBe(false);

    const bare: SourceData = {
      crs: 3006, skipped: 0, features: [
        { layer: "dotknoll", geometry: { kind: "point", at: [101, 100] } },
        { layer: "dotknoll_avlang", geometry: { kind: "point", at: [102, 100] } },
        { layer: "dotknoll_laser", geometry: { kind: "point", at: [140, 100] } },
        { layer: "udepression", geometry: { kind: "point", at: [200, 200] } }
      ]
    };
    const incoming: SourceData = { crs: 3006, skipped: 0, features: knollFeatures(chooseKnollCandidates(candidates, DEFAULT_KNOLL_LIMITS)) };
    const merged = mergeRefinedCandidates(bare, incoming, own, 10_000);
    expect(merged.features.map(f => f.layer)).toEqual(["udepression", "dotknoll_avlang", "dotknoll_laser"]);
    const avlang = merged.features.find(f => f.layer === "dotknoll_avlang");
    expect(avlang?.geometry.kind === "point" && avlang.geometry.toward).toBeDefined();
  });

  it("avdubbletterar äldre kullar.geojson utan aspect/angle inom 6 m mot kvarvarande dotknoll_avlang och små 101-toppringar", () => {
    const legacy: KnollCandidate[] = [
      { at: [103, 100], rise: 1.4, share: 0.9, footM2: 30 }, // 3 m från kvarvarande dotknoll_avlang -> bort
      { at: [300, 100], rise: 1.4, share: 0.9, footM2: 30 }, // inuti r=12 m (~450 m²) 101-ring -> bort i 1:10 000, kvar i 1:4 000 sprint
      { at: [500, 100], rise: 1.4, share: 0.9, footM2: 30 }  // fristående -> kvar
    ];
    const own = knollOwnPattern(legacy);
    expect(own.test("dotknoll_laser")).toBe(true);
    expect(own.test("dotknoll_avlang")).toBe(false);

    const circle: [number, number][] = Array.from({ length: 16 }, (_, i) => [300 + 12 * Math.cos(i * Math.PI / 8), 100 + 12 * Math.sin(i * Math.PI / 8)]);
    const bare: SourceData = {
      crs: 3006, skipped: 0, features: [
        { layer: "dotknoll_avlang", geometry: { kind: "point", at: [100, 100] } },
        { layer: "contour", geometry: { kind: "line", closed: true, points: circle } }
      ]
    };
    const incoming: SourceData = { crs: 3006, skipped: 0, features: knollFeatures(chooseKnollCandidates(legacy, DEFAULT_KNOLL_LIMITS)) };
    const forest = mergeRefinedCandidates(bare, incoming, own, 10_000);
    const forestLaser = forest.features.filter((f): f is SourceFeature & { geometry: { kind: "point"; at: readonly [number, number] } } => f.layer === "dotknoll_laser");
    expect(forestLaser.map(f => f.geometry.at)).toEqual([[500, 100]]);

    const sprint = mergeRefinedCandidates(bare, incoming, own, 4_000);
    const sprintLaser = sprint.features.filter((f): f is SourceFeature & { geometry: { kind: "point"; at: readonly [number, number] } } => f.layer === "dotknoll_laser");
    expect(sprintLaser.map(f => f.geometry.at)).toEqual([[300, 100], [500, 100]]);
  });
});

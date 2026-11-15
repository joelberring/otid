import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { choosePits, DEFAULT_PIT_LIMITS, type PitCandidate } from "../src/base-map/pit-search";
import { marshTest, withoutMarshPits } from "../src/base-map/marsh-pits";

const square = (x: number, y: number, size: number): [number, number][] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
const marsh = (layer = "blott", hole?: [number, number][]): SourceFeature => ({ layer, geometry: { kind: "area", rings: hole ? [square(0, 0, 100), hole] : [square(0, 0, 100)] } });
const dot = (layer: string, x: number, y: number): SourceFeature => ({ layer, geometry: { kind: "point", at: [x, y] } });
const pit = (x: number, y: number, depth: number): PitCandidate => ({ at: [x, y], depth, areaM2: 30, length: 6, width: 5 });

describe("gropar i sankmark (ägaren 2026-11-15)", () => {
  it("en punkt i sankmarken, men inte i ett hål eller utanför", () => {
    const test = marshTest([marsh("blott", square(40, 40, 20)), marsh("vatten")]);
    expect(test(10, 10)).toBe(true); expect(test(50, 50)).toBe(false); expect(test(150, 10)).toBe(false);
    expect(marshTest([marsh("sankmark_fast")])(10, 10)).toBe(true);
    expect(marshTest([marsh("vatten")])(10, 10)).toBe(false);
  });
  it("Karttapullautins gropar i sankmark tas bort, andra punkter och gropar utanför står kvar", () => {
    const features = [marsh("fuktigt"), dot("udepression", 10, 10), dot("uglyudepression", 20, 20), dot("udepression", 150, 10), dot("dotknoll", 30, 30)];
    const out = withoutMarshPits(features);
    expect(out.removed).toBe(2);
    expect(out.features.map(feature => feature.layer)).toEqual(["fuktigt", "udepression", "dotknoll"]);
    expect(withoutMarshPits([dot("dotknoll", 1, 1)]).removed).toBe(0);
  });
  it("den egna sökningens gropar i sankmark står kvar bara när de är minst 1 m djupa", () => {
    const choice = choosePits([pit(10, 10, 0.6), pit(60, 60, 1.2), pit(150, 10, 0.6)], DEFAULT_PIT_LIMITS, 10_000, [marsh()]);
    expect(choice.points.map(([x]) => Math.round(x)).sort((a, b) => a - b)).toEqual([60, 150]);
  });
});

import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { chooseHills, settleHills, type HillCandidate } from "../src/base-map/hill-search";
import { nearLines, shareNear } from "../src/base-map/line-near";

const circle = (cx: number, cy: number, r: number): [number, number][] => Array.from({ length: 48 }, (_, i) => [cx + r * Math.cos(i * Math.PI / 24), cy + r * Math.sin(i * Math.PI / 24)]);
const line = (layer: string, points: [number, number][], closed = false): SourceFeature => ({ layer, elevation: 50, geometry: { kind: "line", points, closed } });
const hill = (cx: number, cy: number, r: number): HillCandidate => ({ at: [cx, cy], top: 51.5, rise: 1.5, areaM2: Math.round(Math.PI * r * r * 2), ring: circle(cx, cy, r) });

describe("linjer på varandra (ägaren 2026-11-15, Ornö)", () => {
  it("avståndet till linjerna och andelen av en ring som ligger nära", () => {
    const near = nearLines([[[0, 0], [100, 0]]], 2);
    expect(near(50, 1.5)).toBe(true); expect(near(50, 3)).toBe(false);
    expect(shareNear(circle(0, 0, 10), nearLines([circle(0, 0, 11)], 2), 1)).toBe(1);
    expect(shareNear(circle(0, 0, 10), nearLines([[[-20, -9], [20, -9]]], 2), 1)).toBeLessThan(0.3);
  });
  it("en höjds ring som till stor del ligger på en kurva ritas inte, en fri ring ritas", () => {
    const contour = line("contour", [...circle(0, 0, 13).slice(0, 30)]);
    const limits = { ringRise: 0.6 };
    expect(chooseHills([hill(0, 0, 12)], limits, 10_000, [contour]).rings).toHaveLength(0);
    expect(chooseHills([hill(0, 0, 12)], limits, 10_000, []).rings).toHaveLength(1);
    expect(chooseHills([hill(0, 0, 12)], limits, 10_000, [line("contour", [[-40, 30], [40, 30]])]).rings).toHaveLength(1);
  });
  it("en punkthöjd som rör en kurva tas bort (och kommer tillbaka med unsettle), en fri står kvar", () => {
    const dot = (x: number, y: number): SourceFeature => ({ layer: "dotknoll", geometry: { kind: "point", at: [x, y] } });
    const features = [line("contour", [[0, 0], [100, 0]]), dot(50, 2), dot(50, 10)];
    const settled = settleHills(features, [], { ringRise: 9 }, 10_000);
    expect(settled.features.filter(feature => feature.layer === "dotknoll").map(feature => (feature.geometry as { readonly at: readonly [number, number] }).at[1])).toEqual([10]);
    expect(settled.hidden).toHaveLength(1);
  });
});

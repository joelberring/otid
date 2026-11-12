import type { SourceFeature } from "@o-tid/map-revision";
import { describe, expect, it } from "vitest";
import { linesOutsideWater } from "./map-project-water-clip";

const lake: SourceFeature = { layer: "vatten", geometry: { kind: "area", rings: [[[100, 0], [200, 0], [200, 100], [100, 100], [100, 0]]] } };
const line = (layer: string, points: [number, number][]): SourceFeature => ({ layer, geometry: { kind: "line", points, closed: false } });

describe("kurvor klipps mot vattnet", () => {
  it("delar en kurva som dras rakt över sjön i två bitar på land", () => {
    const result = linesOutsideWater([lake, line("contour", [[0, 50], [300, 50]])], feature => feature.layer === "contour");
    const parts = result.features.filter(feature => feature.layer === "contour");
    expect(parts).toHaveLength(2);
    expect(result.cut).toBe(1);
    for (const part of parts) if (part.geometry.kind === "line") for (const [x] of part.geometry.points) expect(x <= 100 || x >= 200).toBe(true);
  });
  it("lämnar kurvor på land och andra lager orörda", () => {
    const land = line("contour", [[0, 150], [300, 150]]), ditch = line("dike", [[0, 50], [300, 50]]);
    const result = linesOutsideWater([lake, land, ditch], feature => feature.layer === "contour");
    expect(result.features).toEqual([lake, land, ditch]);
  });
  it("tar bort stumpar i strandkanten", () => {
    const result = linesOutsideWater([lake, line("contour", [[95, 50], [300, 50]])], feature => feature.layer === "contour");
    expect(result.features.filter(feature => feature.layer === "contour")).toHaveLength(1);
  });
});

describe("kurvor mot vattnet på ett helt kartblad", () => {
  it("klarar en havsyta med 20 000 brytpunkter och 300 km kurvor på under tre sekunder", () => {
    const shore: [number, number][] = Array.from({ length: 20_000 }, (_, i) => {
      const angle = i / 20_000 * 2 * Math.PI, radius = 2000 + 60 * Math.sin(i / 7);
      return [3000 + radius * Math.cos(angle), 3000 + radius * Math.sin(angle)];
    });
    const sea: SourceFeature = { layer: "vatten", geometry: { kind: "area", rings: [[...shore, shore[0]!]] } };
    const contours = Array.from({ length: 300 }, (_, i) => line("contour", Array.from({ length: 201 }, (_, k) => [k * 30, i * 20] as [number, number])));
    const started = performance.now();
    const result = linesOutsideWater([sea, ...contours], feature => feature.layer === "contour");
    expect(performance.now() - started).toBeLessThan(3000);
    expect(result.cut).toBeGreaterThan(150);
  });
  it("låter en ö i sjön vara land", () => {
    const island: SourceFeature = { layer: "vatten", geometry: { kind: "area", rings: [[[100, 0], [200, 0], [200, 100], [100, 100], [100, 0]], [[140, 40], [160, 40], [160, 60], [140, 60], [140, 40]]] } };
    const result = linesOutsideWater([island, line("contour", [[142, 50], [158, 50]])], feature => feature.layer === "contour");
    expect(result.features).toHaveLength(2);
    expect(result.cut).toBe(0);
  });
});

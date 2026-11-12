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

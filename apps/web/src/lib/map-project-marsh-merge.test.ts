import type { SourceFeature } from "@o-tid/map-revision";
import { describe, expect, it } from "vitest";
import { singleMarsh } from "./map-project-marsh-merge";

const square = (layer: string, x: number, y: number, size: number, area = false): SourceFeature => {
  const points: [number, number][] = [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
  return { layer, geometry: area ? { kind: "area", rings: [[...points, points[0]!]] } : { kind: "line", closed: true, points } };
};
const areaOf = (feature: SourceFeature) => {
  const ring = feature.geometry.kind === "area" ? feature.geometry.rings[0]! : feature.geometry.kind === "line" ? feature.geometry.points : [];
  return Math.abs(ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0)) / 2;
};

describe("grundkartans sankmark utan överlapp", () => {
  it("klipper fuktigt mot blött och marktäckets sankmark mot båda", () => {
    const result = singleMarsh([square("kurva", 0, 0, 5), square("fuktigt", 0, 0, 100), square("blott", 0, 0, 50), square("sankmark_fast", 50, 50, 100, true)]);
    const by = (layer: string) => result.features.filter(feature => feature.layer === layer);
    expect(by("kurva")).toHaveLength(1);
    expect(areaOf(by("blott")[0]!)).toBe(2500);
    expect(by("fuktigt").reduce((sum, feature) => sum + areaOf(feature), 0)).toBeCloseTo(7500);
    expect(by("sankmark_fast").reduce((sum, feature) => sum + areaOf(feature), 0)).toBeCloseTo(7500);
    expect(result.clipped).toBe(2);
  });
  it("tar bort en sankmark som helt ligger i en annan", () => {
    const result = singleMarsh([square("blott", 0, 0, 100), square("sankmark_vat", 20, 20, 30, true)]);
    expect(result.features.map(feature => feature.layer)).toEqual(["blott"]);
    expect(result.removed).toBe(1);
  });
  it("lämnar allt orört när bara ett slag finns", () => {
    const features = [square("fuktigt", 0, 0, 100), square("fuktigt", 50, 50, 100)];
    expect(singleMarsh(features).features).toEqual(features);
  });
});

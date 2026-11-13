import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { yardsOf } from "../src/base-map/yards";

const house = (x: number, y: number, side: number, layer = "byggnad"): SourceFeature => ({ layer, geometry: { kind: "area",
  rings: [[[x, y], [x + side, y], [x + side, y + side], [x, y + side]]] } });
const bounds = (feature: SourceFeature) => {
  const points = feature.geometry.kind === "line" ? feature.geometry.points : [];
  return { minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minY: Math.min(...points.map(p => p[1])), maxY: Math.max(...points.map(p => p[1])) };
};

describe("tomter ur husen", () => {
  it("ger en tomt på ungefär 20 m kring ett hus", () => {
    const yards = yardsOf([house(1000, 2000, 10)]);
    expect(yards).toHaveLength(1);
    expect(yards[0]!.layer).toBe("tomtmark_hus");
    const box = bounds(yards[0]!);
    expect(box.minX).toBeGreaterThan(975); expect(box.minX).toBeLessThan(984);
    expect(box.maxY).toBeGreaterThan(2026); expect(box.maxY).toBeLessThan(2035);
  });
  it("slår ihop grannars tomter, hoppar över stora hus och annat än hus", () => {
    expect(yardsOf([house(0, 0, 10), house(30, 0, 10, "OSM byggnad")])).toHaveLength(1);
    expect(yardsOf([house(0, 0, 40)])).toHaveLength(0);
    expect(yardsOf([house(0, 0, 10, "vatten")])).toHaveLength(0);
    // Ett hus i ett bostadsområde ur OpenStreetMap har redan sin tomt.
    expect(yardsOf([house(0, 0, 10), { ...house(-50, -50, 120), layer: "tomtmark_osm" }])).toHaveLength(0);
  });
});

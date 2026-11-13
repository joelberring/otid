import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { yardsOf } from "../src/base-map/yards";

const house = (x: number, y: number, side: number, layer = "byggnad"): SourceFeature => ({ layer, geometry: { kind: "area",
  rings: [[[x, y], [x + side, y], [x + side, y + side], [x, y + side]]] } });
const bounds = (feature: SourceFeature) => {
  const points = feature.geometry.kind === "line" ? feature.geometry.points : [];
  return { minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minY: Math.min(...points.map(p => p[1])), maxY: Math.max(...points.map(p => p[1])) };
};

const area = (feature: SourceFeature) => { const p = feature.geometry.kind === "line" ? feature.geometry.points : []; return Math.abs(p.reduce((sum, [x, y], i) => { const [nx, ny] = p[(i + 1) % p.length]!; return sum + x * ny - nx * y; }, 0)) / 2; };
const road = (points: [number, number][], layer = "OSM väg (residential)"): SourceFeature => ({ layer, geometry: { kind: "line", closed: false, points } });

describe("tomter ur husen", () => {
  it("ger en rektangel 15 m utanför ett hus", () => {
    const yards = yardsOf([house(1000, 2000, 10)]);
    expect(yards).toHaveLength(1);
    expect(yards[0]!.layer).toBe("tomtmark_hus");
    expect(yards[0]!.geometry.kind === "line" && yards[0]!.geometry.points).toHaveLength(4);
    const box = bounds(yards[0]!);
    expect(box.minX).toBeCloseTo(985); expect(box.maxX).toBeCloseTo(1025); expect(box.minY).toBeCloseTo(1985); expect(box.maxY).toBeCloseTo(2025);
  });
  it("vrider rektangeln efter huset", () => {
    const tilted: SourceFeature = { layer: "byggnad", geometry: { kind: "area", rings: [[[0, 0], [10, 10], [5, 15], [-5, 5]]] } };
    const [yard] = yardsOf([tilted]);
    // Huset är 14,1 × 7,1 m; tomten 44,1 × 37,1 m oavsett vridningen.
    expect(area(yard!)).toBeCloseTo((Math.hypot(10, 10) + 30) * (Math.hypot(5, 5) + 30), 3);
  });
  it("slår ihop grannar, hoppar över stora hus och annat än hus", () => {
    expect(yardsOf([house(0, 0, 10), house(30, 0, 10, "OSM byggnad")])).toHaveLength(1);
    expect(yardsOf([house(0, 0, 40)])).toHaveLength(0);
    expect(yardsOf([house(0, 0, 10, "vatten")])).toHaveLength(0);
    // Ett hus i ett bostadsområde ur OpenStreetMap har redan sin tomt.
    expect(yardsOf([house(0, 0, 10), { ...house(-50, -50, 120), layer: "tomtmark_osm" }])).toHaveLength(0);
  });
  it("klipper tomten mot en väg och håller isär hus på var sin sida", () => {
    // Vägen går 5 m öster om huset: tomten slutar vid vägen i stället för 15 m ut.
    const [cut] = yardsOf([house(0, 0, 10), road([[15, -100], [15, 100]])]);
    const box = bounds(cut!);
    expect(box.maxX).toBeCloseTo(15); expect(box.minX).toBeCloseTo(-15);
    const two = yardsOf([house(0, 0, 10), house(25, 0, 10), road([[17.5, -100], [17.5, 100]])]);
    expect(two).toHaveLength(2);
    expect(Math.max(...two.map(yard => bounds(yard).maxX))).toBeCloseTo(50);
    // En stig delar inte, och en väg som slutar inne på tomten gör det inte heller.
    expect(bounds(yardsOf([house(0, 0, 10), road([[15, -100], [15, 100]], "OSM stig")])[0]!).maxX).toBeCloseTo(25);
    expect(bounds(yardsOf([house(0, 0, 10), road([[15, -100], [15, 0]])])[0]!).maxX).toBeCloseTo(25);
  });
  it("delar en gles grupp i stället för en stor rektangel över tom mark", () => {
    // Tre hus i vinkel med 40 m emellan: en gemensam rektangel vore mest tom.
    const yards = yardsOf([house(0, 0, 10), house(40, 0, 10), house(0, 40, 10)]);
    expect(yards.length).toBeGreaterThan(1);
    expect(yards.reduce((sum, yard) => sum + area(yard), 0)).toBeLessThan(90 * 90 * 0.8);
  });
});

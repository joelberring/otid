import type { SourceFeature } from "../src";
import { describe, expect, it } from "vitest";
import { marshOutsideManaged, singleMarsh, undergrowthOutsideGreen } from "../src/base-map/marsh-merge";

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
  it("ett blött kärr mitt i ett fuktigt blir ett hål i det fuktiga", () => {
    const result = singleMarsh([square("fuktigt", 0, 0, 100), square("blott", 40, 40, 20)]);
    const moist = result.features.find(feature => feature.layer === "fuktigt")!;
    expect(moist.geometry.kind === "area" && moist.geometry.rings).toHaveLength(2);
    expect(result.clipped).toBe(1);
  });
  it("lämnar allt orört när bara ett slag finns", () => {
    const features = [square("fuktigt", 0, 0, 100), square("fuktigt", 50, 50, 100)];
    expect(singleMarsh(features).features).toEqual(features);
  });
  it("rensar tunna 310-kantskorpor (2·A/P < 3,0 m skog / < 2,5 m sprint) och små 310-skärvor (< 120 m² / < 80 m²) efter 310 − 308", () => {
    const rect = (layer: string, x0: number, y0: number, x1: number, y1: number): SourceFeature => ({
      layer, geometry: { kind: "area", rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] }
    });
    // 1. Rak tunn kantskorpa: 310 (100 × 22,8 m) minus 308 (100 × 20 m) ger 100 × 2,8 m = 280 m² (2A/P = 2,72 m): bort i skog (<3,0 m), kvar i sprint (>=2,5 m).
    const crust = [rect("blott", 0, 0, 100, 20), rect("fuktigt", 0, 0, 100, 22.8)];
    expect(singleMarsh(crust, 15_000).features.filter(f => f.layer === "fuktigt")).toHaveLength(0);
    expect(singleMarsh(crust, 4_000).features.filter(f => f.layer === "fuktigt")).toHaveLength(1);
    // 1b. Naturlig 3,8 m skogskärrsremsa (100 × 3,8 m = 380 m², 2A/P = 3,66 m >= 3,0 m): behålls i skog!
    const corridor = [rect("blott", 0, 0, 100, 20), rect("fuktigt", 0, 0, 100, 23.8)];
    expect(singleMarsh(corridor, 15_000).features.filter(f => f.layer === "fuktigt")).toHaveLength(1);
    // 2. Ringformad tunn kantskorpa runt 308 (2 m bred runtom): 54 × 54 minus 50 × 50 = 416 m², total omkrets 416 m -> 2A/P = 2,0 m -> bort i både skog och sprint!
    const halo = [rect("blott", 2, 2, 52, 52), rect("fuktigt", 0, 0, 54, 54)];
    expect(singleMarsh(halo, 15_000).features.filter(f => f.layer === "fuktigt")).toHaveLength(0);
    expect(singleMarsh(halo, 4_000).features.filter(f => f.layer === "fuktigt")).toHaveLength(0);
    // 3. Liten fyrkantig 310-skärva (10 × 10 = 100 m², 2A/P = 5 m): < 120 m² -> bort i skog, >= 80 m² -> kvar i sprint.
    const smallChunk = [rect("blott", 0, 0, 20, 10), rect("fuktigt", 0, 0, 30, 10)];
    expect(singleMarsh(smallChunk, 15_000).features.filter(f => f.layer === "fuktigt")).toHaveLength(0);
    expect(singleMarsh(smallChunk, 4_000).features.filter(f => f.layer === "fuktigt")).toHaveLength(1);
  });
});

describe("inga kärr på skött mark", () => {
  it("laserns blöta och fuktiga mark klipps mot åker och OpenStreetMaps gräsytor; marktäckets sankmark rörs inte", () => {
    const features = [square("aker", 0, 0, 50), square("blott", 0, 0, 100), square("sankmark_vat", 0, 0, 40, true), square("fuktigt", 200, 0, 100)];
    const result = marshOutsideManaged(features, [square("OSM fritid (park)", 200, 0, 100)]);
    expect(result.map(feature => feature.layer).sort()).toEqual(["aker", "blott", "sankmark_vat"]);
    const wet = result.find(feature => feature.layer === "blott")!;
    expect(wet.geometry.kind === "area" && wet.geometry.rings[0]!.length).toBeGreaterThan(5);
    expect(marshOutsideManaged([square("blott", 0, 0, 100)])).toHaveLength(1);
  });
});

describe("undervegetationen mot det gröna", () => {
  it("klipper rastret mot exklusivt grönt (406, 408 och 410) samt 407 mot 409, och lämnar det gröna", () => {
    const green = square("gron_lattlopt", 0, 0, 50);
    const darkGreen = square("gron_svarlopt", 50, 0, 50);
    const result = undergrowthOutsideGreen([green, darkGreen, square("undervegetation_lattlopt", 0, 0, 100), square("undervegetation_svarlopt", 50, 50, 50)]);
    const by = (layer: string) => result.features.filter(feature => feature.layer === layer);
    expect(by("gron_lattlopt")).toEqual([green]);
    expect(by("gron_svarlopt")).toEqual([darkGreen]);
    expect(areaOf(by("undervegetation_svarlopt")[0]!)).toBe(2500);
    expect(by("undervegetation_lattlopt").reduce((sum, feature) => sum + areaOf(feature), 0)).toBeCloseTo(2500);
  });
  it("spatialt index i withoutOverlap klipper hundratals sankmarker snabbt och exakt", () => {
    const features: SourceFeature[] = [];
    for (let i = 0; i < 250; i += 1) {
      const x = (i % 25) * 100, y = Math.floor(i / 25) * 100;
      features.push(square("blott", x, y, 40), square("fuktigt", x + 20, y, 40));
    }
    const started = performance.now();
    const result = singleMarsh(features);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result.clipped).toBe(250);
    expect(result.features.filter(f => f.layer === "fuktigt").reduce((s, f) => s + areaOf(f), 0)).toBeCloseTo(250 * 800, 0);
  });
});

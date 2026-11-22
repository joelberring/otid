import { describe, expect, it } from "vitest";
import { shoreLines, waterToFrame, withoutDuplicateWater } from "../src/base-map";
import type { SourceFeature } from "../src/vector-parse";

/** Ägaren 2026-11-22: en strand i stället för två, och vattnet ut till kartans ram (water-frame.ts). */
const water = (...rings: [number, number][][]): SourceFeature => ({ layer: "vatten", geometry: { kind: "area", rings } });
const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const extent = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
const areaOf = (feature: SourceFeature) => feature.geometry.kind !== "area" ? 0 : feature.geometry.rings.reduce((sum, ring, index) => {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; twice += a[0] * b[1] - b[0] * a[1]; }
  return sum + (index === 0 ? 1 : -1) * Math.abs(twice) / 2;
}, 0);

describe("vattnet i grundkartan", () => {
  it("tar bort marktäckets havsyta som lasern redan visar, men behåller en göl som lasern missat", () => {
    // Laserns hav: västra halvan av körningen. Marktäckets hav går långt utanför körningen (det räknas inte).
    const laser = [water(square(0, 0, 500, 1000))];
    const sea = water(square(-3000, -3000, 520, 4000)), pond = water(square(800, 800, 820, 820));
    const kept = withoutDuplicateWater([sea, pond, { layer: "skog", geometry: { kind: "point", at: [1, 1] } }], laser, extent);
    expect(kept.map(feature => feature.layer)).toEqual(["vatten", "skog"]);
    expect(kept[0]).toBe(pond);
  });

  it("förlänger vattnet där körningens kant skär av det, med hörnet, och drar ingen strand längs förlängningen", () => {
    // Havet i körningens västra del med en ö; stranden i öster.
    const sea = water(square(0, 0, 400, 1000), square(100, 100, 200, 200).reverse());
    const land = { layer: "kurva", geometry: { kind: "line" as const, closed: false, points: [[600, 0], [600, 1000]] as [number, number][] } };
    const out = waterToFrame([sea, land], extent);
    expect(out.filter(feature => feature.layer === "kurva")).toHaveLength(1);
    const extended = out.filter(feature => feature.layer === "vatten");
    expect(extended).toHaveLength(1);
    // Ön är kvar som hål, och ytan är mycket större än körningens del (rakt ut åt väster, söder, norr och hörnen).
    expect(extended[0]!.geometry.kind === "area" && extended[0]!.geometry.rings).toHaveLength(2);
    expect(areaOf(extended[0]!)).toBeGreaterThan(400 * 1000 * 100);
    // Strandlinjen ur samma vatten före förlängningen: bara östra stranden och ön.
    const shores = shoreLines([sea, land]);
    expect(shores).toHaveLength(2);
  });

  it("rör inte vatten som inte når körningens kant", () => {
    const lake = water(square(300, 300, 400, 400));
    expect(waterToFrame([lake], extent)).toEqual([lake]);
  });
});

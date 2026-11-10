import { describe, expect, it } from "vitest";
import { osmAreaChoices, overpassContaining, project, ringKm2, unproject } from "./osm-area";

describe("områdesväljaren på OpenStreetMap (ägaren 2026-11-10)", () => {
  it("rutornas matematik går fram och tillbaka", () => {
    const { x, y } = project(18.07, 59.33, 12);
    const back = unproject(x, y, 12);
    expect(back.lon).toBeCloseTo(18.07, 6);
    expect(back.lat).toBeCloseTo(59.33, 6);
  });

  it("frågar efter ytor som innehåller punkten, utan kommuner och län", () => {
    const query = overpassContaining(59.3, 18.1);
    expect(query).toContain("is_in(59.300000,18.100000)");
    expect(query).toContain('[!"admin_level"]');
  });

  it("ger slutna vägar och multipolygoner som val, minsta först, och hoppar över för stora", () => {
    const square = (size: number) => [{ lat: 59, lon: 18 }, { lat: 59, lon: 18 + size }, { lat: 59 + size, lon: 18 + size }, { lat: 59 + size, lon: 18 },
      { lat: 59, lon: 18 }];
    const json = { elements: [
      { type: "way", id: 1, tags: { leisure: "park", name: "Parken" }, geometry: square(0.01) },
      { type: "relation", id: 2, tags: { boundary: "protected_area", name: "Reservatet" }, members: [
        { type: "way", role: "outer", geometry: square(0.03).slice(0, 3) },
        { type: "way", role: "outer", geometry: square(0.03).slice(2) }] },
      { type: "way", id: 3, tags: { landuse: "forest" }, geometry: square(1) },
      { type: "way", id: 4, tags: { highway: "path" }, geometry: square(0.01).slice(0, 3) }
    ] };
    const choices = osmAreaChoices(json);
    expect(choices.map(choice => [choice.id, choice.name, choice.kind])).toEqual([["way/1", "Parken", "leisure=park"],
      ["relation/2", "Reservatet", "boundary=protected_area"]]);
    expect(choices[0]!.area).toMatchObject({ crs: "WGS84" });
    expect(choices[0]!.area.rings[0]).toHaveLength(4);
    expect(choices[0]!.km2).toBeCloseTo(ringKm2(choices[0]!.area.rings[0]!), 6);
  });
});

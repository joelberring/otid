import { describe, expect, it } from "vitest";
import type { MapGeoreference } from "@o-tid/map-file";
import type { SourceFeature } from "../src";
import { computeCandidates, type CandidateInput } from "../src/base-map";

// 1:4 000, SWEREF 99 TM; meter i underlaget.
const georeference: MapGeoreference = { scale: 4000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6580000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
const at = (x: number, y: number): [number, number] => [675000 + x, 6580000 + y];
const square = (layer: string, x: number, y: number, side: number): SourceFeature =>
  ({ layer, geometry: { kind: "area", rings: [[at(x, y), at(x + side, y), at(x + side, y + side), at(x, y + side)]] } });
const features: SourceFeature[] = [
  square("byggnad", 0, 0, 20),
  // Laserns kärr intill huset och ett långt bort; OpenStreetMaps bäck intill huset.
  square("blott", 25, 0, 10), square("blott", 200, 0, 10),
  { layer: "OSM vattendrag (stream)", geometry: { kind: "line", closed: false, points: [at(22, -30), at(22, 60)] } },
  // En gata (hårdgjord yta) och en stig genom den.
  square("gata", 0, 100, 40),
  { layer: "OSM stig", geometry: { kind: "line", closed: false, points: [at(-60, 120), at(100, 120)] } }
];
const input = (more: Partial<CandidateInput> = {}): CandidateInput => ({ georeference, crs: 3006,
  mapping: [["byggnad", "hus"], ["blott", "karr"], ["OSM vattendrag (stream)", "back"], ["gata", "yta"], ["OSM stig", "stig"]], skipped: [],
  symbols: [["hus", "521.0", "area"], ["karr", "308.0", "area"], ["back", "305.0", "line"], ["yta", "501.0", "area"], ["stig", "505.0", "line"]],
  bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 }, clip: undefined, area: undefined, stage: undefined, fit: undefined,
  normed: false, built: [], maskBuilt: false, ...more });
const symbolsOf = (more: Partial<CandidateInput> = {}) => computeCandidates(features, input(more))?.objects.map(object => object.symbol).sort();

describe("sprintkartans kandidater: kärr i bebyggt och stigar i vägar", () => {
  it("utan regeln kommer allt med", () => {
    expect(symbolsOf()).toEqual(["back", "hus", "karr", "karr", "stig", "yta"]);
  });
  it("laserns kärr intill huset och stigen inne i gatan tas bort; OpenStreetMaps bäck står kvar", () => {
    const result = computeCandidates(features, input({ sprintClean: { builtMetres: 25 } }));
    expect(result?.objects.map(object => object.symbol).sort()).toEqual(["back", "hus", "karr", "stig", "stig", "yta"]);
    expect(result?.sprintClean).toEqual({ water: 1, paths: 1, rings: 0 });
  });
  it("kartans egna hus räknas också (en huvudkälla som redan lästs in)", () => {
    const only = features.filter(feature => feature.layer === "blott");
    const house = { polygons: [[[{ x: 50, y: -3 }, { x: 53, y: -3 }, { x: 53, y: 3 }, { x: 50, y: 3 }]]], lines: [] };
    const result = computeCandidates(only, input({ sprintClean: { builtMetres: 25, built: house } }));
    expect(result?.objects).toHaveLength(1);
    expect(result?.sprintClean?.water).toBe(1);
  });
});

/** Sprintkartans OpenStreetMap (ägaren 2026-11-13): belagda vägar blir sammanhängande ytor med antagen bredd, obelagda förblir linjer. */
import { describe, expect, it } from "vitest";
import { SYMBOL_SETS } from "@o-tid/map-file";
import { importLayers, LIMITS, osmToSourceData, suggestSymbol, type SourceData, type SourceFeature } from "../src";
import { mergeBaseMap, osmMeters, SPRINT_PAVED_EDGE_LAYER, SPRINT_PAVED_LAYER, sprintOsm, sprintPaved, sprintRoadWidth } from "../src/base-map";

const road = (highway: string, points: [number, number][], tags: Record<string, string> = {}, layer = `OSM väg (${highway})`): SourceFeature =>
  ({ layer, geometry: { kind: "line", points, closed: false }, properties: { highway, ...tags } });
const ringArea = (ring: readonly (readonly [number, number])[]) => Math.abs(ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0)) / 2;
const areaOf = (feature: SourceFeature) => feature.geometry.kind === "area" ? feature.geometry.rings.reduce((sum, ring, index) => sum + (index === 0 ? 1 : -1) * ringArea(ring), 0) : 0;
const layersOf = (data: SourceData) => Object.fromEntries(importLayers(data).map(layer => [layer.name, layer.count]));
/** Ett plant system i meter (SWEREF 99 TM), så att måtten går att räkna på. */
const metric = (features: SourceFeature[]): SourceData => ({ features, crs: 3006, skipped: 0 });

describe("sprintkartans OpenStreetMap", () => {
  it("bredden: taggen går före förvalen per vägklass, och körfälten ger en minsta bredd", () => {
    expect(sprintRoadWidth("footway")).toEqual({ meters: 2.5, assumed: true });
    expect(sprintRoadWidth("residential")).toEqual({ meters: 6, assumed: true });
    expect(sprintRoadWidth("cycleway")).toEqual({ meters: 3, assumed: true });
    expect(sprintRoadWidth("primary_link")).toEqual({ meters: 5, assumed: true });
    expect(sprintRoadWidth("okänd")).toEqual({ meters: 4, assumed: true });
    expect(sprintRoadWidth("residential", { width: "4,5 m" })).toEqual({ meters: 4.5, assumed: false });
    expect(sprintRoadWidth("footway", { est_width: "1.8" })).toEqual({ meters: 1.8, assumed: false });
    expect(sprintRoadWidth("secondary", { lanes: "4" })).toEqual({ meters: 13, assumed: true });
    expect(sprintRoadWidth("residential", { width: "300" }).meters).toBe(40);
    expect(osmMeters("bred")).toBeUndefined();
    expect(osmMeters("2")).toBe(2);
  });

  it("beläggningen: bilvägar och gångvägar är belagda om inte surface säger annat, stigar och traktorvägar tvärtom", () => {
    expect(sprintPaved("residential")).toBe(true);
    expect(sprintPaved("footway")).toBe(true);
    expect(sprintPaved("footway", { surface: "gravel" })).toBe(false);
    expect(sprintPaved("footway", { surface: "compacted" })).toBe(true);
    expect(sprintPaved("path")).toBe(false);
    expect(sprintPaved("path", { surface: "asphalt" })).toBe(true);
    expect(sprintPaved("track")).toBe(false);
    expect(sprintPaved("service", { surface: "unpaved" })).toBe(false);
  });

  it("en gata och en gångväg som möts blir en yta med rätt bredd; kanten blir en sluten linje", () => {
    const result = sprintOsm(metric([
      road("residential", [[0, 0], [100, 0]]),
      road("footway", [[50, 0], [50, 60]], {}, "OSM gångväg och cykelväg")
    ]));
    expect(result.sprint).toEqual({ paved: 2, assumed: 2, unpaved: 0, tunnels: 0, surfaces: 1 });
    expect(layersOf(result)).toEqual({ [SPRINT_PAVED_LAYER]: 1, [SPRINT_PAVED_EDGE_LAYER]: 1 });
    const surface = result.features.find(feature => feature.layer === SPRINT_PAVED_LAYER)!;
    // Gatan 100 m × 6 m och gångvägen 57 m × 2,5 m utanför gatan, plus de avrundade ändarna.
    const expected = 100 * 6 + 57 * 2.5;
    expect(areaOf(surface)).toBeGreaterThan(expected);
    expect(areaOf(surface)).toBeLessThan(expected + 40);
    const xs = surface.geometry.kind === "area" ? surface.geometry.rings[0]!.map(point => point[0]) : [];
    const ys = surface.geometry.kind === "area" ? surface.geometry.rings[0]!.map(point => point[1]) : [];
    expect(Math.min(...ys)).toBeCloseTo(-3, 1);
    expect(Math.max(...ys)).toBeCloseTo(61.25, 1);
    expect(Math.min(...xs)).toBeCloseTo(-3, 1);
    expect(result.features.every(feature => feature.properties === undefined)).toBe(true);
    const edge = result.features.find(feature => feature.layer === SPRINT_PAVED_EDGE_LAYER)!;
    expect(edge.geometry.kind === "line" && edge.geometry.closed).toBe(true);
  });

  it("obelagda vägar och stigar förblir linjer, tunnlar får inget förslag, och trappan rörs inte", () => {
    const result = sprintOsm(metric([
      road("residential", [[0, 0], [50, 0]], { surface: "gravel" }),
      road("footway", [[0, 10], [50, 10]], { surface: "fine_gravel" }, "OSM gångväg och cykelväg"),
      road("path", [[0, 20], [50, 20]], {}, "OSM stig"),
      road("path", [[0, 30], [50, 30]], { surface: "asphalt", width: "2" }, "OSM stig"),
      road("track", [[0, 40], [50, 40]], {}, "OSM traktorväg (track)"),
      road("footway", [[0, 50], [50, 50]], { tunnel: "building_passage" }, "OSM gångväg och cykelväg"),
      road("steps", [[0, 60], [5, 60]], {}, "OSM trappa"),
      { layer: "OSM staket", geometry: { kind: "line", points: [[0, 70], [50, 70]], closed: false } }
    ]));
    expect(layersOf(result)).toEqual({ "OSM obelagd väg (residential)": 1, "OSM obelagd väg (footway)": 1, "OSM stig": 1, "OSM traktorväg (track)": 1,
      "OSM tunnel eller passage": 1, "OSM trappa": 1, "OSM staket": 1, [SPRINT_PAVED_LAYER]: 1, [SPRINT_PAVED_EDGE_LAYER]: 1 });
    expect(result.sprint).toMatchObject({ paved: 1, assumed: 0, unpaved: 4, tunnels: 1 });
    const symbols = SYMBOL_SETS["ISSPROM2019-2"].symbols.map(symbol => ({ id: symbol.code, code: symbol.code, kind: symbol.kind, name: symbol.name }));
    const suggested = Object.fromEntries(importLayers(result).map(layer => [layer.name, suggestSymbol(layer, symbols, "ISSPROM")]));
    expect(suggested).toEqual({ "OSM obelagd väg (residential)": "505", "OSM obelagd väg (footway)": "505", "OSM stig": "506", "OSM traktorväg (track)": "505",
      "OSM tunnel eller passage": undefined, "OSM trappa": "532", "OSM staket": "516", [SPRINT_PAVED_LAYER]: "501", [SPRINT_PAVED_EDGE_LAYER]: "501.1" });
  });

  it("gångytor och parkeringar går in i samma yta; ett kvarter blir ett hål och små skärvor fylls", () => {
    const result = sprintOsm(metric([
      road("residential", [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]),
      { layer: "OSM parkering", geometry: { kind: "area", rings: [[[100, 40], [130, 40], [130, 60], [100, 60]]] } },
      { layer: "OSM gångyta (highway=pedestrian)", geometry: { kind: "area", rings: [[[200, 0], [220, 0], [220, 20], [200, 20]]] } }
    ]));
    const surfaces = result.features.filter(feature => feature.layer === SPRINT_PAVED_LAYER);
    expect(surfaces).toHaveLength(2);
    const block = surfaces.find(feature => feature.geometry.kind === "area" && feature.geometry.rings.length === 2)!;
    expect(block).toBeDefined();
    // Kvarteret innanför gatan: 94 m × 94 m.
    expect(ringArea(block.geometry.kind === "area" ? block.geometry.rings[1]! : [])).toBeCloseTo(94 * 94, -2);
    expect(areaOf(surfaces.find(feature => feature !== block)!)).toBeCloseTo(400, 0);
    expect(result.features.filter(feature => feature.layer === SPRINT_PAVED_EDGE_LAYER)).toHaveLength(3);
  });

  it("ett stort gatunät delas så att varje yta ryms i ett kartobjekt", () => {
    const features: SourceFeature[] = [];
    for (let i = 0; i <= 16; i += 1) {
      features.push(road("residential", [[0, i * 50], [800, i * 50]]), road("residential", [[i * 50, 0], [i * 50, 800]]));
    }
    const started = Date.now();
    const result = sprintOsm(metric(features));
    expect(Date.now() - started).toBeLessThan(5000);
    const surfaces = result.features.filter(feature => feature.layer === SPRINT_PAVED_LAYER);
    expect(surfaces.length).toBeGreaterThan(1);
    for (const surface of surfaces) {
      const rings = surface.geometry.kind === "area" ? surface.geometry.rings : [];
      expect(rings.length).toBeLessThanOrEqual(LIMITS.rings);
      expect(rings.reduce((sum, ring) => sum + ring.length, 0)).toBeLessThanOrEqual(LIMITS.commands);
    }
    // 256 kvarter à 44 m × 44 m är inte belagda.
    const total = surfaces.reduce((sum, surface) => sum + areaOf(surface), 0);
    expect(total).toBeGreaterThan(806 * 806 - 256 * 44 * 44 - 200);
    expect(total).toBeLessThan(806 * 806 - 256 * 44 * 44 + 200);
    // Kanterna: ytterkanten och ett per kvarter.
    expect(result.features.filter(feature => feature.layer === SPRINT_PAVED_EDGE_LAYER)).toHaveLength(257);
  });

  it("Overpass-svaret bär vägens och trädets taggar, och i WGS 84 blir bredden rätt i meter", () => {
    const geometry = (...points: [number, number][]) => points.map(([lon, lat]) => ({ lat, lon }));
    const data = osmToSourceData({ elements: [
      { type: "way", tags: { highway: "residential", width: "8", name: "Gatan" }, geometry: geometry([18, 59.3], [18.002, 59.3]) },
      { type: "way", tags: { highway: "footway", surface: "gravel" }, geometry: geometry([18, 59.301], [18.002, 59.301]) },
      { type: "way", tags: { barrier: "fence", height: "2" }, geometry: geometry([18, 59.302], [18.002, 59.302]) },
      { type: "node", tags: { natural: "tree", diameter_crown: "10" }, lat: 59.3, lon: 18.003 },
      { type: "node", tags: { natural: "tree" }, lat: 59.3, lon: 18.004 }
    ] });
    expect(data.features.map(feature => feature.properties)).toEqual([{ highway: "residential", width: "8" }, { highway: "footway", surface: "gravel" },
      undefined, { diameter_crown: "10" }, undefined]);
    const result = sprintOsm(data);
    expect(layersOf(result)).toEqual({ "OSM obelagd väg (footway)": 1, "OSM staket": 1, "OSM träd (stort)": 1, "OSM träd": 1, [SPRINT_PAVED_LAYER]: 1, [SPRINT_PAVED_EDGE_LAYER]: 1 });
    const ring = result.features.find(feature => feature.layer === SPRINT_PAVED_LAYER)!.geometry;
    const lats = ring.kind === "area" ? ring.rings[0]!.map(point => point[1]) : [];
    // 8 m bred: 4 m åt varje håll, 110 574 m per breddgrad.
    expect((Math.max(...lats) - Math.min(...lats)) * 110_574).toBeCloseTo(8, 1);
    expect(result.sprint).toMatchObject({ paved: 1, assumed: 0 });
  });

  it("grundkartan: bara på en sprintkarta blir OpenStreetMaps vägar ytor", () => {
    const osm = osmToSourceData({ elements: [{ type: "way", tags: { highway: "residential" },
      geometry: [{ lat: 59.3, lon: 18 }, { lat: 59.3, lon: 18.002 }] }] });
    expect(layersOf(mergeBaseMap([], osm, 10000))).toEqual({ "OSM väg (residential)": 1 });
    expect(layersOf(mergeBaseMap([], osm, 4000, undefined, "ISSPROM"))).toEqual({ [SPRINT_PAVED_LAYER]: 1, [SPRINT_PAVED_EDGE_LAYER]: 1 });
  });
});

/** K4c: OpenStreetMap via Overpass blir samma lager och objekt som en vektorfil, med svenska lagernamn som ger symbolförslag. */
import { describe, expect, it } from "vitest";
import { importLayers, joinRings, osmLayer, osmToSourceData, overpassQuery, suggestSymbol, validOsmBox } from "../src";

const geometry = (...points: [number, number][]) => points.map(([lon, lat]) => ({ lat, lon }));
const SYMBOLS = [
  { id: "s521", code: "521.0", kind: "area" }, { id: "s516", code: "516.0", kind: "line" }, { id: "s513", code: "513.0", kind: "line" },
  { id: "s505", code: "505.0", kind: "line" }, { id: "s503", code: "503.0", kind: "line" }, { id: "s532", code: "532.0", kind: "line" },
  { id: "s301", code: "301.0", kind: "area" }, { id: "s417", code: "417.0", kind: "point" }
];

describe("OpenStreetMap", () => {
  it("rutan: giltig och inte för stor", () => {
    expect(validOsmBox({ south: 59.29, west: 18.0, north: 59.31, east: 18.04 })).toBe(true);
    expect(validOsmBox({ south: 59.0, west: 18.0, north: 59.5, east: 18.5 })).toBe(false);
    expect(validOsmBox({ south: 59.31, west: 18.0, north: 59.29, east: 18.04 })).toBe(false);
    expect(overpassQuery({ south: 59.29, west: 18, north: 59.31, east: 18.04 })).toContain("(59.2900000,18.0000000,59.3100000,18.0400000)");
  });

  it("lagren och symbolförslagen ur namnen", () => {
    const data = osmToSourceData({ elements: [
      { type: "way", tags: { building: "yes" }, geometry: geometry([18, 59], [18.001, 59], [18.001, 59.001], [18, 59]) },
      { type: "way", tags: { barrier: "fence" }, geometry: geometry([18, 59], [18.002, 59]) },
      { type: "way", tags: { barrier: "wall" }, geometry: geometry([18, 59], [18.002, 59.001]) },
      { type: "way", tags: { highway: "footway" }, geometry: geometry([18, 59], [18.003, 59]) },
      { type: "way", tags: { highway: "residential" }, geometry: geometry([18, 59], [18.004, 59]) },
      { type: "way", tags: { highway: "steps" }, geometry: geometry([18, 59], [18.0001, 59]) },
      { type: "way", tags: { highway: "bus_stop" }, geometry: geometry([18, 59], [18.0001, 59]) },
      { type: "node", tags: { natural: "tree" }, lat: 59, lon: 18 },
      { type: "relation", tags: { type: "multipolygon", natural: "water" }, members: [
        { type: "way", role: "outer", geometry: geometry([18, 59], [18.01, 59], [18.01, 59.01]) },
        { type: "way", role: "outer", geometry: geometry([18, 59.01], [18.01, 59.01]) },
        { type: "way", role: "outer", geometry: geometry([18, 59.01], [18, 59]) },
        { type: "way", role: "inner", geometry: geometry([18.004, 59.004], [18.005, 59.004], [18.005, 59.005], [18.004, 59.004]) }
      ] }
    ] });
    expect(data.crs).toBe(4326);
    expect(data.skipped).toBe(1);
    const layers = importLayers(data);
    const suggested = Object.fromEntries(layers.map(layer => [layer.name, suggestSymbol(layer, SYMBOLS)]));
    expect(suggested).toEqual({ "OSM byggnad": "s521", "OSM staket": "s516", "OSM mur": "s513", "OSM gångväg och cykelväg": "s505",
      "OSM väg (residential)": "s503", "OSM trappa": "s532", "OSM träd": "s417", "OSM vatten": "s301" });
    const water = data.features.find(feature => feature.layer === "OSM vatten")!.geometry;
    expect(water.kind === "area" && water.rings.length).toBe(2);
  });

  it("ringarna fogas ihop; öppna rester hoppas över", () => {
    expect(joinRings([[[0, 0], [1, 0]], [[1, 1], [1, 0]], [[1, 1], [0, 0]]])).toEqual([[[0, 0], [1, 0], [1, 1]]]);
    expect(joinRings([[[0, 0], [1, 0]]])).toEqual([]);
    expect(osmLayer({ building: "roof" }, true)?.layer).toBe("OSM skärmtak (building=roof)");
    expect(() => osmToSourceData({ nope: 1 })).toThrow();
  });
});

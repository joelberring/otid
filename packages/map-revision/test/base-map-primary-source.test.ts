import { geodeticToGrid, transverseMercatorFor, type MapObject } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import type { SourceData, SourceFeature } from "../src";
import { mergeBaseMap } from "../src/base-map/merge";
import {
  coverageArea, insideArea, osmOnlyCodes, osmOutsidePrimary, osmRemovals, primaryKinds, type PrimaryArea, type PrimaryForMerge
} from "../src/base-map/primary-source";

/** PLAN K4c Huvudkälla (ägaren 2026-11-23): OpenStreetMap hoppas över inom huvudkällans område för de slag den täcker. */
const projection = transverseMercatorFor(3006)!;
const sweref = (lon: number, lat: number): [number, number] => { const at = geodeticToGrid(projection, lat, lon); return [at.easting, at.northing]; };
// Huvudkällans område: lon 17.870–17.875, lat 59.290–59.292 (ca 285 × 220 m).
const PRIMARY: PrimaryForMerge = { name: "liljeholmen.dxf", kinds: ["buildings", "roads"],
  rings: [[sweref(17.870, 59.290), sweref(17.875, 59.290), sweref(17.875, 59.292), sweref(17.870, 59.292)]] };
// Ett hus om ca 12 × 11 m med nedre vänstra hörnet i (lon, lat).
const house = (lon: number, lat: number): SourceFeature => ({ layer: "OSM byggnad", geometry: { kind: "area",
  rings: [[[lon, lat], [lon + 0.0002, lat], [lon + 0.0002, lat + 0.0001], [lon, lat + 0.0001]]] } });
const line = (layer: string, points: [number, number][], properties?: Record<string, string>): SourceFeature =>
  ({ layer, geometry: { kind: "line", closed: false, points }, ...(properties ? { properties } : {}) });
const osm = (...features: SourceFeature[]): SourceData => ({ crs: 4326, skipped: 0, features });

describe("huvudkälla i grundkartan", () => {
  it("OpenStreetMaps hus innanför tas bort, utanför blir de kvar; stigar blir alltid kvar", () => {
    const merged = mergeBaseMap([], osm(house(17.872, 59.291), house(17.880, 59.291), line("OSM stig", [[17.871, 59.2905], [17.874, 59.2905]])),
      undefined, undefined, "ISOM", undefined, [], [PRIMARY]);
    const layers = merged.features.map(feature => feature.layer);
    expect(layers.filter(layer => layer === "OSM byggnad")).toHaveLength(1);
    expect(layers).toContain("OSM stig");
    expect(merged.primary).toEqual([{ name: "liljeholmen.dxf", kinds: ["buildings", "roads"], removed: 1 }]);
    const kept = merged.features.find(feature => feature.layer === "OSM byggnad")!;
    expect(kept.geometry.kind === "area" && kept.geometry.rings[0]![0]![0]).toBeGreaterThan(sweref(17.876, 59.291)[0]);
  });

  it("tomterna kring husen följer: inget hus innanför ger ingen tomt där", () => {
    const without = mergeBaseMap([], osm(house(17.872, 59.291), house(17.880, 59.291)));
    const withPrimary = mergeBaseMap([], osm(house(17.872, 59.291), house(17.880, 59.291)), undefined, undefined, "ISOM", undefined, [], [PRIMARY]);
    const yards = (data: SourceData) => data.features.filter(feature => feature.layer === "tomtmark_hus").length;
    expect(yards(without)).toBe(2);
    expect(yards(withPrimary)).toBe(1);
  });

  it("en väg som korsar kanten klipps, och sprintens belagda yta görs bara av delen utanför", () => {
    const road = line("OSM väg (residential)", [[17.873, 59.291], [17.879, 59.291]], { highway: "residential" });
    const forest = mergeBaseMap([], osm(road), undefined, undefined, "ISOM", undefined, [], [PRIMARY]);
    const roads = forest.features.filter(feature => feature.layer === "OSM väg (residential)");
    expect(roads).toHaveLength(1);
    const xs = roads[0]!.geometry.kind === "line" ? roads[0]!.geometry.points.map(point => point[0]) : [];
    expect(Math.min(...xs)).toBeGreaterThan(sweref(17.875, 59.291)[0] - 1);
    // Sprint: gatan blir en belagd yta med antagen bredd, men bara utanför huvudkällan.
    const sprint = mergeBaseMap([], osm(road), undefined, undefined, "ISSPROM", undefined, [], [PRIMARY]);
    const paved = sprint.features.filter(feature => feature.layer === "OSM belagd yta (antagen bredd)");
    expect(paved.length).toBeGreaterThan(0);
    for (const area of paved) if (area.geometry.kind === "area") for (const [x, y] of area.geometry.rings[0]!) expect(insideArea(PRIMARY.rings, x + 4, y)).toBe(false);
    // Med hela vägen innanför blir ingen belagd yta alls; utan huvudkällan blir det en.
    const inner = line("OSM väg (residential)", [[17.871, 59.291], [17.874, 59.291]], { highway: "residential" });
    expect(mergeBaseMap([], osm(inner), undefined, undefined, "ISSPROM", undefined, [], [PRIMARY]).features.some(feature => /belagd/.test(feature.layer))).toBe(false);
    expect(mergeBaseMap([], osm(inner), undefined, undefined, "ISSPROM").features.some(feature => /belagd yta/.test(feature.layer))).toBe(true);
  });

  it("bara slagen som huvudkällan täcker: murar och järnväg blir kvar när källan bara har hus", () => {
    const only = { ...PRIMARY, kinds: ["buildings"] as const };
    const out = osmOutsidePrimary(osm(house(17.872, 59.291), line("OSM mur", [[17.871, 59.291], [17.872, 59.291]]), line("OSM järnväg", [[17.871, 59.2915], [17.874, 59.2915]]),
      line("OSM väg (service)", [[17.871, 59.2912], [17.874, 59.2912]], { highway: "service" })), [only], false);
    expect(out.data.features.map(feature => feature.layer)).toEqual(["OSM mur", "OSM järnväg", "OSM väg (service)"]);
    expect(out.outcomes).toEqual([{ name: "liljeholmen.dxf", kinds: ["buildings"], removed: 1 }]);
  });
});

describe("huvudkällans slag och område", () => {
  it("slagen ur symbolerna utkastet fick", () => {
    expect(primaryKinds(["521", "501", "501.1", "509", "512.1", "301.1", "516", "405"], true)).toEqual(["buildings", "roads", "railway", "bridges", "water", "fences"]);
    expect(primaryKinds(["504.0", "513"], false)).toEqual(["roads", "walls"]);
    expect(primaryKinds(["504"], true)).toEqual([]);
  });

  const box = (x: number, y: number, size: number): MapObject => ({ kind: "area", symbol: "521", angle: 0,
    rings: [[{ type: "M", x, y }, { type: "L", x: x + size, y }, { type: "L", x: x + size, y: y + size }, { type: "L", x, y: y + size }]] });
  const ringsOf = (area: PrimaryArea) => area.flatMap(polygon => polygon.map(ring => ring.map(p => [p.x, p.y] as const)));

  it("täckningen följer objekten (inte hela rutan) och klipps mot kartans område", () => {
    // Två kluster i var sitt hörn: mitten av rutan hör inte till täckningen.
    const objects = [box(0, 0, 10), box(5, 5, 10), box(190, 190, 10)];
    const area = coverageArea(objects, { cellMm: 5 });
    const rings = ringsOf(area);
    expect(insideArea(rings, 7, 7)).toBe(true);
    expect(insideArea(rings, 195, 195)).toBe(true);
    expect(insideArea(rings, 100, 100)).toBe(false);
    // Buffrad med en ruta: strax utanför huset räknas, långt utanför inte.
    expect(insideArea(rings, -3, 5)).toBe(true);
    expect(insideArea(rings, -12, 5)).toBe(false);
    const clipped = coverageArea(objects, { cellMm: 5, clip: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]] });
    expect(insideArea(ringsOf(clipped), -3, 5)).toBe(false);
    expect(insideArea(ringsOf(clipped), 195, 195)).toBe(false);
    expect(insideArea(ringsOf(clipped), 7, 7)).toBe(true);
    expect(coverageArea([], { cellMm: 5 })).toEqual([]);
  });
});

describe("urvalet för borttagning", () => {
  const area: PrimaryArea = [[[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]]];
  const at = (x: number, symbol = "521"): MapObject => ({ kind: "area", symbol, angle: 0,
    rings: [[{ type: "M", x, y: 10 }, { type: "L", x: x + 4, y: 10 }, { type: "L", x: x + 4, y: 14 }, { type: "L", x, y: 14 }]] });

  it("bara orörda objekt ur OpenStreetMap, av huvudkällans slag, inom området", () => {
    const objects = [
      { key: "osm-inne", code: "521", object: at(10) },
      { key: "osm-ute", code: "521", object: at(200) },
      { key: "osm-andrad", code: "521", object: at(20) },
      { key: "egen", code: "521", object: at(30) },
      { key: "osm-stig", code: "505", object: at(40, "505") },
      { key: "lm-hus", code: "521", object: at(50) },
      { key: "nyss", code: "521", object: at(60) }
    ];
    // Utkastet med OpenStreetMap: 521 bara ur OSM:s lager. Det ändrade objektet finns inte bland de orörda nycklarna.
    const origin = [{ codes: ["505", "521"], keys: ["osm-inne", "osm-ute", "osm-stig", "nyss"] }, { codes: [], keys: ["lm-hus"] }];
    const picked = osmRemovals({ objects, origin, area, kinds: ["buildings", "roads"], sprint: true, exclude: new Set(["nyss"]) });
    expect(picked.remove).toEqual(["osm-inne"]);
    expect(picked.kept).toBe(3);
  });

  it("symbolen räknas som OpenStreetMaps bara när inget annat lager gav den", () => {
    expect(osmOnlyCodes([{ layer: "OSM byggnad", symbol: "521", accepted: true }, { layer: "OSM väg (residential)", symbol: "503.0", accepted: true },
      { layer: "belagt", symbol: "501", accepted: true }, { layer: "OSM gångyta (highway=pedestrian)", symbol: "501", accepted: true },
      { layer: "OSM staket", symbol: "516", accepted: false }, { layer: "kurvor", symbol: "101", accepted: true }])).toEqual(["503", "521"]);
    expect(osmOnlyCodes([{ layer: "byggnad", symbol: "521", accepted: true }, { layer: "OSM byggnad", symbol: "521", accepted: true }])).toEqual([]);
  });
});

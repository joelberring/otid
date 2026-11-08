import { describe, expect, it } from "vitest";
import type { MapGeoreference } from "@o-tid/map-file";
import {
  guessCrs, importLayers, importObjects, joinLines, parseDxf, parseGeoJson, sourcePointToMap, suggestSymbol, VectorParseError
} from "../src";

/** ADR-0219 K4b: GeoJSON och DXF, lagren, symbolförslagen, omräkningen och städningen. */
const georef: MapGeoreference = { scale: 10000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6580000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
const toMap = (x: number, y: number) => sourcePointToMap(georef, 3006, x, y);
const symbols = [{ id: "s521", code: "521", kind: "area" }, { id: "s516", code: "516", kind: "line" }, { id: "s505", code: "505", kind: "line" },
  { id: "s417", code: "417", kind: "point" }];

const dxf = (entities: string[][]) => ["0", "SECTION", "2", "HEADER", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
  ...entities.flat(), "0", "ENDSEC", "0", "EOF"].join("\r\n");

describe("vektorunderlagen (K4b)", () => {
  it("läser GeoJSON med lager ur egenskaperna och den gamla crs-medlemmen", () => {
    const data = parseGeoJson(JSON.stringify({ type: "FeatureCollection", crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::3006" } },
      features: [
        { type: "Feature", properties: { objekttyp: "Byggnad" }, geometry: { type: "Polygon", coordinates: [[[675000, 6580000], [675010, 6580000], [675010, 6580010], [675000, 6580000]]] } },
        { type: "Feature", properties: { layer: "Staket" }, geometry: { type: "MultiLineString", coordinates: [[[675000, 6580020], [675010, 6580020]], [[1, 2]]] } },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [675005, 6580030] } },
        { type: "Feature", properties: {}, geometry: { type: "Circle" } }
      ] }));
    expect(data.crs).toBe(3006);
    expect(data.skipped).toBe(2);
    expect(data.features[0]).toEqual({ layer: "Byggnad", geometry: { kind: "area", rings: [[[675000, 6580000], [675010, 6580000], [675010, 6580010]]] } });
    expect(importLayers(data).map(layer => [layer.name, layer.count])).toEqual([["Byggnad", 1], ["Staket", 1], ["Point", 1]]);
    expect(parseGeoJson('{"type":"Point","coordinates":[18,59]}').crs).toBe(4326);
    expect(() => parseGeoJson("inte json")).toThrow(VectorParseError);
  });

  it("läser DXF: punkter, linjer, polylinjer (slutna) och hoppar över det okända", () => {
    const data = parseDxf(dxf([
      ["0", "POINT", "8", "TRAD", "10", "675001", "20", "6580001", "30", "0"],
      ["0", "LINE", "8", "STAKET", "10", "675000", "20", "6580000", "11", "675010", "21", "6580000"],
      ["0", "LWPOLYLINE", "8", "HUS", "90", "4", "70", "1", "10", "675000", "20", "6580000", "10", "675010", "20", "6580000", "10", "675010", "20", "6580010"],
      ["0", "POLYLINE", "8", "STIG", "70", "0"], ["0", "VERTEX", "8", "STIG", "10", "1", "20", "2"], ["0", "VERTEX", "8", "STIG", "10", "3", "20", "4"],
      ["0", "SEQEND", "8", "STIG"],
      ["0", "TEXT", "8", "TEXT", "10", "1", "20", "1", "1", "Hej"]
    ]));
    expect(data.skipped).toBe(1);
    expect(data.features.map(row => [row.layer, row.geometry.kind, row.geometry.kind === "line" ? row.geometry.closed : null]))
      .toEqual([["TRAD", "point", null], ["STAKET", "line", false], ["HUS", "line", true], ["STIG", "line", false]]);
    expect(guessCrs(data)).toBe(3006);
    expect(() => parseDxf("AutoCAD Binary DXF\r\n")).toThrow(VectorParseError);
  });

  it("föreslår symbol ur namnet och formen", () => {
    const layer = (name: string, shape: Partial<Record<"points" | "lines" | "closedLines" | "areas", number>>) =>
      ({ name, count: 1, points: 0, lines: 0, closedLines: 0, areas: 0, ...shape });
    expect(suggestSymbol(layer("ByggnadYta", { areas: 3 }), symbols)).toBe("s521");
    expect(suggestSymbol(layer("HUS_LINJE", { closedLines: 3 }), symbols)).toBe("s521");
    expect(suggestSymbol(layer("Stängsel", { lines: 3 }), symbols)).toBe("s516");
    expect(suggestSymbol(layer("GÅNGVÄG", { lines: 1 }), symbols)).toBe("s505");
    expect(suggestSymbol(layer("Träd", { points: 4 }), symbols)).toBe("s417");
    expect(suggestSymbol(layer("0153", { lines: 4 }), symbols)).toBeUndefined();
  });

  it("räknar om, slår ihop brutna linjer, tar bort dubbletter, stumpar och det utanför kartan", () => {
    const features = [
      { layer: "STAKET", geometry: { kind: "line" as const, points: [[675000, 6580000], [675010, 6580000]] as [number, number][], closed: false } },
      { layer: "STAKET", geometry: { kind: "line" as const, points: [[675020, 6580000], [675010, 6580000]] as [number, number][], closed: false } },
      { layer: "STAKET", geometry: { kind: "line" as const, points: [[675030, 6580030], [675030.5, 6580030]] as [number, number][], closed: false } },
      { layer: "HUS", geometry: { kind: "line" as const, points: [[675000, 6580050], [675010, 6580050], [675010, 6580060]] as [number, number][], closed: true } },
      { layer: "HUS", geometry: { kind: "line" as const, points: [[675000, 6580050], [675010, 6580050], [675010, 6580060]] as [number, number][], closed: true } },
      { layer: "HUS", geometry: { kind: "line" as const, points: [[675000, 6580070], [675010, 6580070]] as [number, number][], closed: false } },
      { layer: "HUS", geometry: { kind: "area" as const, rings: [[[690000, 6580000], [690010, 6580000], [690010, 6580010]]] as [number, number][][] } },
      { layer: "ANNAT", geometry: { kind: "point" as const, at: [675000, 6580000] as [number, number] } }
    ];
    const result = importObjects(features, { toMap, bounds: { minX: -10, minY: -10, maxX: 100, maxY: 100 },
      mapping: new Map([["STAKET", { symbol: "s516", kind: "line" as const }], ["HUS", { symbol: "s521", kind: "area" as const }]]) });
    expect(result).toMatchObject({ outside: 1, duplicates: 1, short: 1, joined: 1, mismatched: 1 });
    expect(result.objects).toHaveLength(2);
    const fence = result.objects.find(object => object.kind === "line")!;
    expect(fence.kind === "line" && fence.path.map(command => [Math.round(command.x * 100) / 100, Math.round(command.y * 100) / 100])).toEqual([[0, 0], [1, 0], [2, 0]]);
    expect(result.objects.find(object => object.kind === "area")).toMatchObject({ symbol: "s521", angle: 0 });
  });

  it("slår ihop i båda ändarna och åt båda hållen", () => {
    const p = (x: number) => ({ x, y: 0 });
    const result = joinLines([[p(1), p(2)], [p(0), p(1)], [p(3), p(2)], [p(5), p(6)]]);
    expect(result.joined).toBe(2);
    expect(result.lines.map(line => line.map(point => point.x))).toEqual([[0, 1, 2, 3], [5, 6]]);
  });
});

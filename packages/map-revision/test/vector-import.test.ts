import { describe, expect, it } from "vitest";
import type { MapGeoreference } from "@o-tid/map-file";
import {
  clipLine, clipRing, guessCrs, importLayers, importObjects, joinLines, parseDxf, parseGeoJson, sourcePointToMap, suggestSymbol, VectorParseError
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

  it("lagret ur objekttyp och undertyp tillsammans (Stockholms baskarta), utan upprepning när de är lika", () => {
    const at = { type: "Point", coordinates: [675005, 6580030] };
    const data = parseGeoJson(JSON.stringify({ type: "FeatureCollection", features: [
      { type: "Feature", properties: { objekttyp: "Markanläggning", undertyp: "Staket", mark: "På" }, geometry: at },
      { type: "Feature", properties: { OBJEKTTYP: "Vägutbredning", Undertyp: "Vägutbredning" }, geometry: at },
      { type: "Feature", properties: { objekttyp: "Byggnad", undertyp: null }, geometry: at },
      { type: "Feature", properties: { layer: "Eget lager", objekttyp: "Markanläggning", undertyp: "Slänt" }, geometry: at },
      { type: "Feature", properties: { undertyp: "Gatuträd" }, geometry: at }
    ] }));
    expect(data.features.map(feature => feature.layer)).toEqual(["Markanläggning Staket", "Vägutbredning", "Byggnad", "Eget lager", "Point"]);
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

  it("känner igen Stockholms lokala zon (SWEREF 99 18 00) med kartans georeferens, och hoppar över punkter i origo (ägaren 2026-11-10)", () => {
    const data = parseDxf(dxf([
      ["0", "POINT", "8", "RAM", "10", "0", "20", "0", "30", "0"],
      ["0", "LINE", "8", "VAG", "10", "151892", "20", "6570944", "11", "151990", "21", "6570990"],
      ["0", "LINE", "8", "VAG", "10", "153000", "20", "6571000", "11", "153100", "21", "6571050"]
    ]));
    const georeference = { scale: 15000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6570000 }, mapRefPoint: { x: 0, y: 0 },
      grivationDegrees: 0, combinedScaleFactor: 1 } as const;
    expect(guessCrs(data)).toBeUndefined();
    expect(guessCrs(data, georeference)).toBe(3011);
    // Göteborg i SWEREF 99 TM: ingen lokal zon i Stockholm passar.
    expect(guessCrs(data, { ...georeference, refPoint: { easting: 319000, northing: 6400000 } })).toBeUndefined();
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
    // Karttapullautins lager (K5).
    const isom = ["101", "102", "103", "104", "201", "202"].map(code => ({ id: `s${code}`, code, kind: "line" }))
      .concat([{ id: "s109", code: "109", kind: "point" }, { id: "s111", code: "111", kind: "point" }]);
    expect(Object.fromEntries(["contour", "contour_index", "contour_intermed", "depression_intermed", "formline", "slope_line", "cliff2", "cliff3"]
      .map(name => [name, suggestSymbol(layer(name, { lines: 2 }), isom)]))).toEqual({ contour: "s101", contour_index: "s102",
      contour_intermed: undefined, depression_intermed: undefined, formline: "s103", slope_line: "s104", cliff2: "s202", cliff3: "s201" });
    expect(suggestSymbol(layer("dotknoll", { points: 2 }), isom)).toBe("s109");
    // De osäkra knollarna och groparna föreslås inte (ägaren 2026-11-11).
    expect(suggestSymbol(layer("uglydotknoll", { points: 2 }), isom)).toBeUndefined();
    expect(suggestSymbol(layer("uglyudepression", { points: 2 }), isom)).toBeUndefined();
    expect(suggestSymbol(layer("udepression", { points: 2 }), isom)).toBe("s111");
    // Lantmäteriets Marktäcke och Byggnad (G8).
    const land = ["301", "308", "310", "401", "403", "404", "412", "413", "521"].map(code => ({ id: `s${code}`, code, kind: "area" }));
    expect(Object.fromEntries(["vatten", "oppen_mark", "aker", "fruktodling", "sankmark_vat", "sankmark_fast", "byggnad", "bebyggelse", "oppen_mark_laser", "oppen_mark_spridda_trad"]
      .map(name => [name, suggestSymbol(layer(name, { areas: 2 }), land)]))).toEqual({ vatten: "s301", oppen_mark: "s401", aker: "s412", fruktodling: "s413",
      sankmark_vat: "s308", sankmark_fast: "s310", byggnad: "s521", bebyggelse: undefined, oppen_mark_laser: "s403", oppen_mark_spridda_trad: "s404" });
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

  it("klipper linjer och ytor mot kartans kant", () => {
    const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const p = (x: number, y: number) => ({ x, y });
    // In, ut och in igen: två bitar.
    expect(clipLine([p(-5, 5), p(5, 5), p(5, 15), p(8, 15), p(8, 5)], box)).toEqual([[p(0, 5), p(5, 5), p(5, 10)], [p(8, 10), p(8, 5)]]);
    expect(clipLine([p(-5, -5), p(-1, -1)], box)).toEqual([]);
    expect(clipRing([p(-5, -5), p(5, -5), p(5, 5), p(-5, 5)], box)).toEqual([p(0, 0), p(5, 0), p(5, 5), p(0, 5)]);
    expect(clipRing([p(20, 20), p(30, 20), p(30, 30)], box)).toEqual([]);
    // I importen: en byggnad över kanten klipps, en linje över kanten blir kortare.
    const result = importObjects([
      { layer: "HUS", geometry: { kind: "area", rings: [[[674995, 6580000], [675005, 6580000], [675005, 6580010]]] } },
      { layer: "STAKET", geometry: { kind: "line", points: [[674990, 6580020], [675010, 6580020]], closed: false } }
    ], { toMap, bounds: { minX: 0, minY: -10, maxX: 100, maxY: 100 },
      mapping: new Map([["STAKET", { symbol: "s516", kind: "line" as const }], ["HUS", { symbol: "s521", kind: "area" as const }]]) });
    expect(result).toMatchObject({ clipped: 2, outside: 0 });
    const fence = result.objects.find(object => object.kind === "line");
    expect(fence?.kind === "line" && fence.path[0]!.x).toBeCloseTo(0, 6);
  });

  it("slutna linjer i ett ytlager: en ring inuti en annan blir hål, och en ö i hålet en egen yta (ägaren 2026-11-16)", () => {
    const square = (x: number, y: number, size: number): [number, number][] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
    const ring = (x: number, y: number, size: number) => ({ layer: "OPPEN", geometry: { kind: "line" as const, points: square(675000 + x, 6580000 + y, size), closed: true } });
    const result = importObjects([ring(0, 0, 100), ring(20, 20, 50), ring(30, 30, 10), ring(200, 0, 30)], { toMap,
      mapping: new Map([["OPPEN", { symbol: "s521", kind: "area" as const }]]) });
    const areas = result.objects.filter(object => object.kind === "area");
    expect(areas.map(area => area.kind === "area" ? area.rings.length : 0).sort()).toEqual([1, 1, 2]);
  });

  it("slår ihop i båda ändarna och åt båda hållen", () => {
    const p = (x: number) => ({ x, y: 0 });
    const result = joinLines([[p(1), p(2)], [p(0), p(1)], [p(3), p(2)], [p(5), p(6)]]);
    expect(result.joined).toBe(2);
    expect(result.lines.map(line => line.map(point => point.x))).toEqual([[0, 1, 2, 3], [5, 6]]);
  });

  it("städar baskartor: fasadlinjer blir byggnadsytor, samma byggnad som yta och linje blir en, steg blir trappa", () => {
    const line = (layer: string, points: [number, number][]) => ({ layer, geometry: { kind: "line" as const, points, closed: false } });
    const features = [
      // Fyra fasadlinjer som sluter sig (1 m = 0,1 mm vid 1:10 000).
      line("FASAD", [[675000, 6580000], [675010, 6580000]]), line("FASAD", [[675010, 6580000], [675010, 6580010]]),
      line("FASAD", [[675010, 6580010], [675000, 6580010]]), line("FASAD", [[675000, 6580010], [675000, 6580000]]),
      // Samma byggnad som skraffyr med annan startpunkt och riktning.
      { layer: "HUSYTA", geometry: { kind: "area" as const, rings: [[[675010, 6580010], [675010, 6580000], [675000, 6580000], [675000, 6580010]]] as [number, number][][] } },
      // Fem steg, 3 m breda, 0,4 m mellan.
      ...[0, 1, 2, 3, 4].map(step => line("TRAPPA", [[675050, 6580050 + step * 0.4], [675053, 6580050 + step * 0.4]])),
      // Två steg är ingen trappa och ritas inte (lagret har trappsteg).
      line("TRAPPA", [[675080, 6580050], [675083, 6580050]]), line("TRAPPA", [[675080, 6580050.4], [675083, 6580050.4]])
    ];
    const result = importObjects(features, { toMap, minLengthMm: 0, stairs: { symbols: [{ id: "s532" }], scale: 10000 },
      mapping: new Map([["FASAD", { symbol: "s521", kind: "area" as const }], ["HUSYTA", { symbol: "s521", kind: "area" as const }],
        ["TRAPPA", { symbol: "s532", kind: "line" as const }]]) });
    expect(result).toMatchObject({ closedAreas: 1, duplicates: 1, stairs: 1, steps: 5, stairDropped: 2, mismatched: 0 });
    expect(result.stairLayers).toEqual([{ layer: "TRAPPA", lines: 7, stairs: 1, steps: 5, dropped: 2 }]);
    expect(result.objects.filter(object => object.kind === "area")).toHaveLength(1);
    const stairs = result.objects.filter(object => object.kind === "line");
    expect(stairs).toHaveLength(1);
    // Mittlinjen i gångriktningen (norrut), mitt i stegen: x = 675051,5 m.
    const stair = stairs[0]!;
    const middle = toMap(675051.5, 6580050.8);
    expect(stair.kind === "line" && stair.path).toHaveLength(2);
    if (stair.kind === "line") for (const command of stair.path) expect(command.x).toBeCloseTo(middle.x, 2);
  });
});

describe("joinLines vid korsningar (ägaren 2026-11-15: raka streck ur OpenStreetMap)", () => {
  it("fogar bara på linjens nuvarande ände: tre stigar som möts blir två linjer utan hopp", () => {
    const p = (x: number, y: number) => ({ x, y });
    const a = [p(0, 0), p(10, 0)], b = [p(10, 0), p(20, 0)], c = [p(10, 50), p(10, 0)];
    const result = joinLines([a, b, c]);
    expect(result.lines).toHaveLength(2);
    // Ingen sträcka längre än den längsta i indata (50).
    for (const line of result.lines) for (let i = 1; i < line.length; i += 1) {
      expect(Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y)).toBeLessThanOrEqual(50);
    }
    const points = result.lines.flat().map(point => `${point.x},${point.y}`);
    expect(points).toContain("0,0"); expect(points).toContain("20,0"); expect(points).toContain("10,50");
  });

  it("hittar grannändpunkter över 0,01 mm-cellgränsen (3×3-sökning) utan att foga punkter längre isär", () => {
    const p = (x: number, y: number) => ({ x, y });
    // 0,0049 avrundas till cell 0 medan 0,0051 avrundas till cell 1, men avståndet är bara 0,0002 mm <= 0,01 mm.
    const across = joinLines([[p(0, 0), p(0.0049, 0)], [p(0.0051, 0), p(10, 0)]]);
    expect(across.joined).toBe(1);
    expect(across.lines).toHaveLength(1);
    expect(across.lines[0]).toHaveLength(3);
    // Avstånd 0,0151 mm > 0,01 mm får inte fogas ihop.
    const far = joinLines([[p(0, 0), p(0.0049, 0)], [p(0.02, 0), p(10, 0)]]);
    expect(far.joined).toBe(0);
    expect(far.lines).toHaveLength(2);
  });

  it("hanterar 10 000 slutna ringar (med hål) och långa hopslagna kedjor utan O(N^2)-inbromsning", () => {
    const features = [];
    // 5 000 yttre kvadrater + 5 000 hål inuti var sin kvadrat = 10 000 ringar.
    for (let i = 0; i < 5000; i += 1) {
      const col = i % 100, row = Math.floor(i / 100);
      const x = 675000 + col * 20, y = 6580000 + row * 20;
      features.push({
        layer: "OPPEN",
        geometry: { kind: "line" as const, closed: true, points: [[x, y], [x + 12, y], [x + 12, y + 12], [x, y + 12]] as [number, number][] }
      });
      features.push({
        layer: "OPPEN",
        geometry: { kind: "line" as const, closed: true, points: [[x + 3, y + 3], [x + 9, y + 3], [x + 9, y + 9], [x + 3, y + 9]] as [number, number][] }
      });
    }
    const started = performance.now();
    const imported = importObjects(features, { toMap, mapping: new Map([["OPPEN", { symbol: "s521", kind: "area" as const }]]) });
    expect(performance.now() - started).toBeLessThan(3000);
    expect(imported.objects).toHaveLength(5000);
    expect(imported.objects.every(obj => obj.kind === "area" && obj.rings.length === 2)).toBe(true);

    // 2 000 omkastade segment i en sammanhängande kedja slås ihop linjärt.
    const chain = Array.from({ length: 2000 }, (_, i) => [{ x: i, y: 0 }, { x: i + 1, y: 0 }]);
    const shuffled = [...chain.filter((_, i) => i % 2 === 0), ...chain.filter((_, i) => i % 2 === 1).reverse()];
    const t0 = performance.now();
    const joined = joinLines(shuffled);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(joined.joined).toBe(1999);
    expect(joined.lines).toHaveLength(1);
    expect(joined.lines[0]).toHaveLength(2001);
  });

  it("läser stor DXF med indexskanning över lång HEADER/TABLES-sektion samt både LF och CRLF", () => {
    const headerLines = ["0", "SECTION", "2", "HEADER"];
    for (let i = 0; i < 500; i += 1) headerLines.push("9", `$VAR${i}`, "70", String(i));
    headerLines.push("0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");
    for (let i = 0; i < 1000; i += 1) {
      headerLines.push("0", "LWPOLYLINE", "8", "HUS", "70", "1", "10", String(i * 10), "20", "0",
        "10", String(i * 10 + 5), "20", "0", "10", String(i * 10 + 5), "20", "5");
    }
    headerLines.push("0", "ENDSEC", "0", "SECTION", "2", "OBJECTS", "0", "ENDSEC", "0", "EOF", "");
    const crlf = parseDxf(headerLines.join("\r\n"));
    const lf = parseDxf(headerLines.join("\n"));
    expect(crlf.features).toHaveLength(1000);
    expect(lf.features).toHaveLength(1000);
    expect(crlf.skipped).toBe(0);
    expect(() => parseDxf("inte-tal\nSECTION\n")).toThrow(VectorParseError);
    expect(() => parseDxf("0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n")).toThrow(VectorParseError);
  });
});

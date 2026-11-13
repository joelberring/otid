/** Grundkartan hela vägen till kartans objekt (AI-kopplingens apply_base_map): samma förval som importen i webben. */
import { describe, expect, it } from "vitest";
import { newMapFile, readMapFile, projectedToMapPoint } from "@o-tid/map-file";
import { areaBounds, assembleBaseMap, candidateSymbols, editorBounds } from "../src/base-map";

const E = 674000, N = 6575000;
const map = readMapFile(newMapFile({ symbolSet: "ISOM2017-2", scale: 10000, refPoint: { easting: E, northing: N }, declinationDegrees: 0 }), "ny.omap", { sources: true });
const georeference = map.georeference!;
const corner = (x: number, y: number) => projectedToMapPoint(georeference, { easting: E + x, northing: N + y });
const area = [[corner(-500, -400), corner(500, -400), corner(500, 400), corner(-500, 400)]];
const dxf = (layer: string, points: [number, number][]) => ["0", "SECTION", "2", "ENTITIES", "0", "LWPOLYLINE", "8", layer, "70", "0",
  ...points.flatMap(([x, y]) => ["10", String(E + x), "20", String(N + y)]), "0", "ENDSEC", "0", "EOF", ""].join("\n");
const knolls = (points: [number, number][]) => JSON.stringify({ type: "FeatureCollection", features: points.map(([x, y]) => ({ type: "Feature",
  geometry: { type: "Point", coordinates: [E + x, N + y] }, properties: { rise: 1.2, share: 0.9, foot: 30 } })) });
const input = { georeference, symbols: candidateSymbols(map), bounds: editorBounds(map, area), area, built: [], today: "2026-11-13", scannedAt: null };

describe("grundkartan till kartans objekt", () => {
  it("symbolerna kommer i palettens ordning och rutan är området med marginal när kartan är tom", () => {
    const codes = candidateSymbols(map).map(([, code]) => code);
    expect(codes.indexOf("101")).toBeLessThan(codes.indexOf("201"));
    expect(codes.length).toBeGreaterThan(100);
    expect(areaBounds([[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]])).toEqual({ minX: -10, minY: -10, maxX: 110, maxY: 60 });
    expect(editorBounds(map, area)).toEqual(areaBounds(area));
    expect(editorBounds({ objects: [], bounds: null }, null)).toEqual({ minX: -100, minY: -100, maxX: 100, maxY: 100 });
  });

  it("lagren får importens förslag, objekten klipps mot området, och ett lager utan förslag räknas som överhoppat", () => {
    const result = assembleBaseMap({ ...input, parts: [{ name: "kurvor.dxf", body: dxf("contour", [[-300, 0], [0, 40], [900, 0]]) },
      { name: "brantlinjer.dxf", body: dxf("okant_lager", [[0, 100], [50, 100]]) }] });
    if ("problem" in result) throw new Error(result.problem);
    expect(result.summary.layers).toEqual([{ layer: "contour", features: 1, symbol: "101" }, { layer: "okant_lager", features: 1, symbol: null }]);
    expect(result.summary).toMatchObject({ objects: 1, symbols: [{ symbol: "101", objects: 1 }], skipped: { unmappedLayers: 1, unmappedFeatures: 1 } });
    const line = result.objects[0]!;
    expect(line.kind).toBe("line");
    expect(Math.max(...(line.kind === "line" ? line.path.map(command => command.x) : []))).toBeLessThanOrEqual(Math.max(...area[0]!.map(point => point.x)) + 0.01);
  });

  it("nivån för små kullar väljer bland jobbets sparade (5 = förvalen, 1 = glesast), och en trasig fil ger ett besked", () => {
    const parts = [{ name: "kurvor.dxf", body: dxf("contour", [[-300, 0], [0, 40], [300, 0]]) }];
    const body = knolls([[0, 200], [15, 200], [30, 200], [45, 200], [100, 200]]);
    const count = (level: number) => {
      const result = assembleBaseMap({ ...input, parts, knolls: { level, body } });
      if ("problem" in result) throw new Error(result.problem);
      return [result.summary.knolls, result.summary.symbols.find(row => row.symbol === "109")?.objects];
    };
    // Förvalen: minst 10 m emellan (alla fem). Nivå 1 kräver 2 m höjd: ingen väljs, och då ändras inget.
    expect(count(5)).toEqual([{ level: 5, chosen: 5, candidates: 5 }, 5]);
    expect(count(1)).toEqual([{ level: 1, chosen: 0, candidates: 5 }, undefined]);
    expect(assembleBaseMap({ ...input, parts, knolls: { level: 5, body: "{inte json" } })).toHaveProperty("problem");
  });

  it("lugnar kurvorna på flack mark när jobbets fuktdjup följer med, och säger hur mycket som togs bort", () => {
    // En hjälpkurva från väst till öst och lutningen 6° väster om mitten, 0,3° öster om (celler om 2 m, 500 × 400).
    const columns = 500, rows = 400, steps = new Uint8Array(columns * rows);
    for (let p = 0; p < steps.length; p += 1) steps[p] = p % columns < columns / 2 ? 60 : 3;
    const flat = { level: 3, grid: { columns, rows, steps }, affine: [2, 0, E - 499, 0, -2, N + 399] as const };
    const parts = [{ name: "kurvor.dxf", body: dxf("contour", [[-300, 100], [0, 140], [300, 100]]) }, { name: "formlinjer.dxf", body: dxf("formline", [[-200, 0], [200, 0]]) }];
    const lengthOf = (result: ReturnType<typeof assembleBaseMap>) => {
      if ("problem" in result) throw new Error(result.problem);
      const id = candidateSymbols(map).find(([, code]) => code.replace(/\.0$/, "") === "103")?.[0];
      const formline = result.objects.flatMap(object => object.kind === "line" && object.symbol === id ? [object.path] : [])[0];
      return { summary: result.summary, mm: formline ? Math.abs(formline[formline.length - 1]!.x - formline[0]!.x) : 0 };
    };
    const plain = lengthOf(assembleBaseMap({ ...input, parts })), calmed = lengthOf(assembleBaseMap({ ...input, parts, flat }));
    expect(plain.summary.flatContours).toBeUndefined();
    expect(plain.mm).toBeCloseTo(40, 0);
    // Den flacka östra halvan klipps bort, utom närmast sluttningen där fönstret (40 m) ännu har brant mark i sig; kurvan rörs inte.
    expect(calmed.summary.flatContours).toMatchObject({ level: 3, rings: 0 });
    expect(calmed.summary.flatContours!.formlineMeters).toBeGreaterThanOrEqual(175);
    expect(calmed.summary.flatContours!.formlineMeters).toBeLessThan(200);
    expect(calmed.mm).toBeGreaterThan(20);
    expect(calmed.mm).toBeLessThan(22.5);
    expect(calmed.summary.symbols.find(row => row.symbol === "101")).toEqual(plain.summary.symbols.find(row => row.symbol === "101"));
    expect(lengthOf(assembleBaseMap({ ...input, parts, flat: { ...flat, level: 0 } })).mm).toBeCloseTo(40, 0);
  });
});

import { describe, expect, it } from "vitest";
import { clipDxfEntities, coarserPng, clipLine, clipRing, decodePng, dxfFrame, encodeRawPng, mergeGeoJson, mosaicPng, ownsPoint, readWorld, toRgba, writeWorld, type RawPng } from "../../../scripts/geo-merge.ts";
import { parseDxf } from "../src/vector-parse";

/** Ägaren 2026-11-14: etapperna i en delad laserkörning läggs ihop på geo-servern (scripts/geo-merge.ts). */
const west = { minX: 0, minY: 0, maxX: 100, maxY: 100 }, east = { minX: 100, minY: 0, maxX: 200, maxY: 100 }, union = { minX: 0, minY: 0, maxX: 200, maxY: 100 };

describe("klippning mot etappens ruta", () => {
  it("delar en linje vid kanten och behåller bitarna inne i rutan", () => {
    expect(clipLine([[50, 50], [150, 50]], west)).toEqual([[[50, 50], [100, 50]]]);
    expect(clipLine([[50, 50], [150, 50], [150, 60], [50, 60]], west)).toEqual([[[50, 50], [100, 50]], [[100, 60], [50, 60]]]);
    expect(clipLine([[120, 10], [180, 10]], west)).toEqual([]);
  });
  it("klipper en yta till en yta", () => {
    expect(clipRing([[50, 10], [150, 10], [150, 20], [50, 20]], west).map(point => point.join()).sort()).toEqual(["100,10", "100,20", "50,10", "50,20"]);
  });
  it("ger en punkt på snittet till en etapp, och ytterkanten till den yttersta", () => {
    expect([ownsPoint(west, union, [100, 50]), ownsPoint(east, union, [100, 50])]).toEqual([false, true]);
    expect(ownsPoint(east, union, [200, 100])).toBe(true);
  });
});

const dxf = (entities: string) => `  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nSECTION\n  2\nENTITIES\n${entities}  0\nENDSEC\n  0\nEOF\n`;
const polyline = (layer: string, points: [number, number][], closed = false, elevation?: number) =>
  `  0\nPOLYLINE\n  8\n${layer}\n 66\n1\n 70\n${closed ? 1 : 0}\n${elevation === undefined ? "" : ` 38\n${elevation}\n`}${points.map(([x, y]) => `  0\nVERTEX\n  8\n${layer}\n 10\n${x}\n 20\n${y}\n`).join("")}  0\nSEQEND\n`;

describe("DXF ur etapperna som en fil", () => {
  const stage = (text: string, box: typeof west, first: boolean, areas = false) => clipDxfEntities(text, box, union, { first, areas });
  const join = (first: string, lines: string[]) => `${dxfFrame(first).head}${lines.join("\n")}\n0\nENDSEC\n0\nEOF\n`;
  it("klipper kurvorna kant i kant och behåller lager och höjd", () => {
    // Samma kurva i båda etapperna (50 m marginal över snittet), och en punkt på vardera sidan.
    const a = dxf(polyline("contour", [[20, 50], [150, 50]], false, 35) + "  0\nPOINT\n  8\nsten\n 10\n40\n 20\n40\n  0\nPOINT\n  8\nsten\n 10\n140\n 20\n40\n");
    const b = dxf(polyline("contour", [[50, 50], [180, 50]], false, 35) + "  0\nPOINT\n  8\nsten\n 10\n140\n 20\n40\n");
    const merged = parseDxf(join(a, [...stage(a, west, true), ...stage(b, east, false)]));
    const lines = merged.features.filter(feature => feature.geometry.kind === "line");
    expect(lines.map(feature => [feature.layer, feature.elevation, feature.geometry.kind === "line" ? feature.geometry.points : []]))
      .toEqual([["contour", 35, [[20, 50], [100, 50]]], ["contour", 35, [[100, 50], [180, 50]]]]);
    expect(merged.features.filter(feature => feature.geometry.kind === "point").map(feature => feature.geometry.kind === "point" ? feature.geometry.at : [])).toEqual([[40, 40], [140, 40]]);
  });
  it("lämnar objekt helt inne i rutan som de är och tar bort dem utanför", () => {
    const text = dxf(polyline("cliff", [[10, 10], [20, 20]]) + polyline("cliff", [[110, 10], [120, 20]]));
    expect(parseDxf(join(text, stage(text, west, true))).features).toHaveLength(1);
  });
  it("klipper en sluten linje till öppna bitar, men en yta till en sluten yta", () => {
    const text = dxf(polyline("green", [[50, 10], [150, 10], [150, 20], [50, 20]], true));
    const open = parseDxf(join(text, stage(text, west, true))).features[0]!.geometry;
    expect(open.kind === "line" && open.closed).toBe(false);
    const area = parseDxf(join(text, stage(text, west, true, true))).features[0]!.geometry;
    expect(area.kind === "line" && area.closed && area.points.length).toBe(4);
  });
});

describe("GeoJSON ur etapperna som en fil", () => {
  it("klipper ytor och linjer och delar punkterna mellan etapperna", () => {
    const file = (features: unknown[]) => JSON.stringify({ type: "FeatureCollection", crs: { type: "name", properties: { name: "EPSG:3006" } }, features });
    const lake = { type: "Feature", properties: { layer: "vatten" }, geometry: { type: "Polygon", coordinates: [[[50, 10], [150, 10], [150, 20], [50, 20], [50, 10]]] } };
    const knoll = (x: number) => ({ type: "Feature", properties: { rise: 1 }, geometry: { type: "Point", coordinates: [x, 50] } });
    const merged = JSON.parse(mergeGeoJson([{ text: file([lake, knoll(40), knoll(100), knoll(130)]), box: west }, { text: file([lake, knoll(100), knoll(130)]), box: east }], union)) as
      { crs: unknown; features: { geometry: { type: string; coordinates: number[][][] | number[] } }[] };
    expect(merged.crs).toBeTruthy();
    expect(merged.features.filter(feature => feature.geometry.type === "Point").map(feature => (feature.geometry.coordinates as number[])[0])).toEqual([40, 100, 130]);
    const lakes = merged.features.filter(feature => feature.geometry.type === "Polygon").map(feature => (feature.geometry.coordinates as number[][][])[0]!);
    expect(lakes.map(ring => [Math.min(...ring.map(p => p[0]!)), Math.max(...ring.map(p => p[0]!))])).toEqual([[50, 100], [100, 150]]);
    expect(lakes.every(ring => ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1])).toBe(true);
  });
});

describe("bilderna ur etapperna som en bild", () => {
  const gray = (width: number, height: number, value: number): RawPng => ({ width, height, bitDepth: 8, colorType: 0, bpp: 1, data: new Uint8Array(width * height).fill(value) });
  it("läser tillbaka det den skriver, i alla format", () => {
    const rgba: RawPng = { width: 3, height: 2, bitDepth: 8, colorType: 6, bpp: 4, data: Uint8Array.from({ length: 24 }, (_, i) => i * 9) };
    const deep: RawPng = { width: 2, height: 2, bitDepth: 16, colorType: 0, bpp: 2, data: Uint8Array.from([1, 2, 3, 4, 250, 6, 7, 8]) };
    const palette: RawPng = { width: 2, height: 1, bitDepth: 8, colorType: 3, bpp: 1, data: Uint8Array.from([0, 1]), palette: Uint8Array.from([255, 0, 0, 0, 255, 0]), transparency: Uint8Array.from([0, 255]) };
    for (const image of [rgba, deep, palette, gray(5, 4, 7)]) {
      const back = decodePng(encodeRawPng(image));
      expect([back.width, back.height, back.bitDepth, back.colorType, [...back.data]]).toEqual([image.width, image.height, image.bitDepth, image.colorType, [...image.data]]);
    }
    expect([...toRgba(palette).data]).toEqual([255, 0, 0, 0, 0, 255, 0, 255]);
  });
  it("lägger skarven i snittet, inte i marginalen, och behåller marginalen utanför körningen", () => {
    // 10 m bildpunkter. Väst täcker x −50…150 (värde 1), öst 50…250 (värde 2); snittet går vid x = 100.
    const world = (left: number) => readWorld(writeWorld({ size: 10, left, top: 100 }));
    const merged = mosaicPng([{ image: gray(20, 10, 1), world: world(-50), box: west }, { image: gray(20, 10, 2), world: world(50), box: east }], union);
    expect([merged.image.width, merged.image.height, merged.world.left, merged.world.top]).toEqual([30, 10, -50, 100]);
    expect([...merged.image.data.subarray(0, 30)]).toEqual([...Array<number>(15).fill(1), ...Array<number>(15).fill(2)]);
  });
  it("lägger remsor ovanpå varandra i höjdled och fyller en glipa med grannens bild", () => {
    const south = { minX: 0, minY: 0, maxX: 100, maxY: 100 }, north = { minX: 0, minY: 100, maxX: 100, maxY: 200 }, both = { minX: 0, minY: 0, maxX: 100, maxY: 200 };
    // Norr når ner till y = 60 (marginal); syd börjar först vid y = 90 (en bildpunkt för kort) och går till −10.
    const merged = mosaicPng([{ image: gray(10, 10, 1), world: { size: 10, left: 0, top: 90 }, box: south }, { image: gray(10, 14, 2), world: { size: 10, left: 0, top: 200 }, box: north }], both);
    const column = Array.from({ length: merged.image.height }, (_, row) => merged.image.data[row * merged.image.width]);
    expect(column).toEqual([...Array<number>(11).fill(2), ...Array<number>(10).fill(1)]);
  });
  it("gör om till RGBA när etapperna har olika format", () => {
    const rgba: RawPng = { width: 1, height: 1, bitDepth: 8, colorType: 6, bpp: 4, data: Uint8Array.from([9, 8, 7, 255]) };
    const merged = mosaicPng([{ image: gray(1, 1, 5), world: { size: 10, left: 0, top: 10 }, box: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
      { image: rgba, world: { size: 10, left: 10, top: 10 }, box: { minX: 10, minY: 0, maxX: 20, maxY: 10 } }], { minX: 0, minY: 0, maxX: 20, maxY: 10 });
    expect([merged.image.colorType, ...merged.image.data]).toEqual([6, 5, 5, 5, 255, 9, 8, 7, 255]);
  });
  it("lägger etapper med olika upplösning på den grövsta (ägaren 2026-11-14)", () => {
    // Västra etappen har 1 m, östra 2 m: den västra blir 2 m (medelvärdet av 2 × 2) och hamnar bredvid den östra.
    const fine = gray(4, 2, 0), data = fine.data.slice();
    data.set([10, 30, 50, 70, 20, 40, 60, 80]); const west1 = { ...fine, data };
    const merged = mosaicPng([{ image: west1, world: { size: 1, left: 0, top: 2 }, box: { minX: 0, minY: 0, maxX: 4, maxY: 2 } },
      { image: gray(2, 1, 200), world: { size: 2, left: 4, top: 2 }, box: { minX: 4, minY: 0, maxX: 8, maxY: 2 } }], { minX: 0, minY: 0, maxX: 8, maxY: 2 });
    expect(merged.world.size).toBe(2);
    expect([merged.image.width, merged.image.height]).toEqual([4, 1]);
    const reds = Array.from({ length: 4 }, (_, i) => merged.image.data[i * merged.image.bpp]);
    expect(reds).toEqual([25, 65, 200, 200]);
  });
  it("gör en bild grövre: medelvärde vid helt tal, mittpunkten annars, genomskinligt väger inte in", () => {
    const rgba: RawPng = { width: 2, height: 1, bitDepth: 8, colorType: 6, bpp: 4, data: Uint8Array.from([100, 0, 0, 255, 0, 0, 0, 0]) };
    expect([...coarserPng(rgba, 2).data]).toEqual([100, 0, 0, 128]);
    const odd = coarserPng(gray(3, 3, 7), 1.5);
    expect([odd.width, odd.height, odd.data[0]]).toEqual([2, 2, 7]);
  });
  it("säger nej till vridna världsfiler", () => {
    expect(() => readWorld("1\n0.1\n0\n-1\n0\n0\n")).toThrow();
  });
});

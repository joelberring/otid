import { describe, expect, it } from "vitest";
import { colorUsage, drawMap, type MapColor, type MapObject, type MapSymbol, type ParsedMap } from "../src";
import { fakeContext } from "./fake-canvas";

const color = (id: number, rank: number): MapColor => ({ id, name: `Färg ${id}`, rank, cmyk: { c: 0, m: 0, y: 0, k: 0 }, rgb: { r: 0, g: 0, b: 0 }, opacity: 1 });
const code = (text: string) => ({ text, main: Number(text.split(".")[0]), sub: Number(text.split(".")[1] ?? 0) });
const square = (x: number, y: number, size: number) => [{ type: "M" as const, x, y }, { type: "L" as const, x: x + size, y },
  { type: "L" as const, x: x + size, y: y + size }, { type: "L" as const, x, y }];

const symbols: MapSymbol[] = [
  { id: "contour", kind: "LINE", code: code("101"), name: "Höjdkurva", hidden: false, strokes: [{ color: 2, width: 0.14 }] },
  { id: "lake", kind: "AREA", code: code("301.1"), name: "Sjö", hidden: false, fill: 3, hatches: [], border: [{ color: 1, width: 0.18 }] },
  { id: "boulder", kind: "POINT", code: code("206"), name: "Sten", hidden: false, elements: [{ kind: "dot", color: 1, center: { x: 0, y: 0 }, diameter: 0.4 }] },
  { id: "secret", kind: "POINT", code: code("999"), name: "Dold", hidden: true, elements: [{ kind: "dot", color: 4, center: { x: 0, y: 0 }, diameter: 1 }] }
];
const objects: MapObject[] = [
  { kind: "line", symbol: "contour", path: [{ type: "M", x: 1, y: 1 }, { type: "L", x: 30, y: 20 }] },
  { kind: "area", symbol: "lake", rings: [square(100, 100, 10)], angle: 0 },
  { kind: "point", symbol: "boulder", at: { x: 105, y: 105 }, angle: 0 },
  { kind: "point", symbol: "boulder", at: { x: 106, y: 101 }, angle: 0 },
  { kind: "point", symbol: "secret", at: { x: 5, y: 5 }, angle: 0 }
];
const map: ParsedMap = { format: "OMAP", version: "Mapper v9", colors: [color(1, 0), color(2, 1), color(3, 2), color(4, 3)], symbols: new Map(symbols.map(s => [s.id, s])),
  objects, scale: 10_000, georeference: null, bounds: { minX: 0, minY: 0, maxX: 120, maxY: 120 }, warnings: [] };

describe("colorUsage (BL-förslaget)", () => {
  it("räknar objekt, sorter och symbolnummer per färg och var färgen syns tätast; dolda symboler räknas inte", () => {
    const usage = colorUsage(map);
    expect(usage.get(1)).toEqual({ objects: 3, kinds: ["LINE", "POINT"], codes: ["206", "301.1"], mains: [206, 301], sample: { x: expect.closeTo(105.333, 2) as number, y: expect.closeTo(103.667, 2) as number } });
    expect(usage.get(2)).toMatchObject({ objects: 1, kinds: ["LINE"], codes: ["101"] });
    expect(usage.get(3)).toMatchObject({ kinds: ["AREA"], mains: [301] });
    expect(usage.has(4)).toBe(false);
  });

  it("onlyColors ritar bara de valda färgerna (banan mitt i färgordningen)", () => {
    const { ctx, calls } = fakeContext();
    drawMap(ctx, map, { pxPerMm: 1, origin: { x: 0, y: 120 }, onlyColors: new Set([2]), background: false });
    expect(calls.filter(call => call.op === "stroke")).toHaveLength(1);
    expect(calls.filter(call => call.op === "fill" || call.op === "fillRect")).toHaveLength(0);
  });
});

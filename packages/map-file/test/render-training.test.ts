import { describe, expect, it } from "vitest";
import { drawMap, type MapColor, type MapObject, type MapSymbol, type ParsedMap } from "../src";
import { fakeContext } from "./fake-canvas";

const color = (id: number, rgb: [number, number, number]): MapColor =>
  ({ id, name: `Färg ${id}`, rank: id, cmyk: { c: 0, m: 0, y: 0, k: 0 }, rgb: { r: rgb[0], g: rgb[1], b: rgb[2] }, opacity: 1 });
const code = (text: string) => ({ text, main: Number(text.split(".")[0]), sub: Number(text.split(".")[1] ?? 0) });
const symbols: MapSymbol[] = [
  { id: "kurva", kind: "LINE", code: code("101"), name: "Höjdkurva", hidden: false, strokes: [{ color: 1, width: 0.14 }] },
  { id: "stig", kind: "LINE", code: code("505"), name: "Stig", hidden: false, strokes: [{ color: 2, width: 0.25 }] }
];
const objects: MapObject[] = [
  { kind: "line", symbol: "kurva", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }] },
  { kind: "line", symbol: "stig", path: [{ type: "M", x: 0, y: 5 }, { type: "L", x: 10, y: 5 }] }
];
const map: ParsedMap = { format: "OMAP", version: "test", colors: [color(1, [0.7, 0.4, 0.1]), color(2, [0, 0, 0])], symbols: new Map(symbols.map(s => [s.id, s])),
  objects, scale: 10_000, georeference: null, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, warnings: [] };

describe("drawMap i träningsläget (ADR-0192)", () => {
  it("ritar inte objekt med dolda symboler", () => {
    const { ctx, calls } = fakeContext();
    const report = drawMap(ctx, map, { pxPerMm: 10, origin: { x: 0, y: 10 }, hiddenSymbols: new Set(["stig"]) });
    expect(report.parts).toBe(1);
    expect(calls.filter(call => call.op === "stroke")).toHaveLength(1);
  });

  it("klipper jämn–udda inom och utanför ytor efter transformen och släpper klippningen efteråt", () => {
    const { ctx, calls } = fakeContext();
    const square = [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }, { x: 1, y: 4 }];
    drawMap(ctx, map, { pxPerMm: 10, origin: { x: 0, y: 10 }, clip: { within: [[square]], without: [[square], [square, square]] } });
    const ops = calls.map(call => call.op);
    const clips = calls.filter(call => call.op === "clip");
    expect(clips.map(call => call.args[0])).toEqual(["evenodd", "evenodd", "evenodd"]);
    // Klippningen ligger mellan fyllningen av papperet och första strecket, inom save/restore.
    expect(ops.indexOf("fillRect")).toBeLessThan(ops.indexOf("clip"));
    expect(ops.indexOf("clip")).toBeLessThan(ops.indexOf("stroke"));
    expect(ops.lastIndexOf("restore")).toBeGreaterThan(ops.lastIndexOf("stroke"));
    // Utanför-ytan ritas med en ram runt bilden: 4 hörn + kvadraten.
    const lineTos = (from: number, to: number) => calls.slice(from, to).filter(call => call.op === "lineTo" || call.op === "moveTo").length;
    const second = calls.indexOf(clips[1]!), first = calls.indexOf(clips[0]!);
    expect(lineTos(first + 1, second)).toBe(8);
  });
});

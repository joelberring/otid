import { describe, expect, it } from "vitest";
import {
  drawMap, mmToPixel, offsetPolyline, pixelToMm, placementsAlong, preferredPxPerMm, renderSize, type MapCanvasContext, type MapColor,
  type MapObject, type MapSymbol, type ParsedMap
} from "../src";

/** En falsk canvas som spelar in anropen och de egenskaper som sätts. */
type Call = { op: string; args: unknown[]; state: Record<string, unknown> };
function fakeContext(width = 400, height = 300) {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const stack: Record<string, unknown>[] = [];
  const record = (op: string) => (...args: unknown[]) => { calls.push({ op, args, state: { ...state } }); };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, key: string) {
      if (key === "canvas") return { width, height };
      if (key === "save") return () => { stack.push({ ...state }); calls.push({ op: "save", args: [], state: { ...state } }); };
      if (key === "restore") return () => { Object.assign(state, stack.pop() ?? {}); calls.push({ op: "restore", args: [], state: { ...state } }); };
      if (key === "setLineDash") return (dash: number[]) => { state.lineDash = dash; };
      if (key in state) return state[key];
      return record(key);
    },
    set(_target, key: string, value) { state[key] = value; return true; }
  };
  return { ctx: new Proxy({}, handler) as unknown as MapCanvasContext, calls };
}

const color = (id: number, rank: number, rgb: [number, number, number], opacity = 1): MapColor =>
  ({ id, name: `Färg ${id}`, rank, cmyk: { c: 0, m: 0, y: 0, k: 0 }, rgb: { r: rgb[0], g: rgb[1], b: rgb[2] }, opacity });
const code = (text: string) => ({ text, main: Number(text.split(".")[0]), sub: Number(text.split(".")[1] ?? 0) });
const square = (x: number, y: number, size: number) => [{ type: "M" as const, x, y }, { type: "L" as const, x: x + size, y },
  { type: "L" as const, x: x + size, y: y + size }, { type: "L" as const, x, y: y + size }, { type: "L" as const, x, y }];

const BLACK = color(1, 0, [0, 0, 0]);
const BLUE = color(2, 1, [0, 0.6, 1]);
const YELLOW = color(3, 5, [1, 0.8, 0.3]);
const GREEN = color(4, 4, [0.3, 0.8, 0.3]);

function map(symbols: MapSymbol[], objects: MapObject[], extra: Partial<ParsedMap> = {}): ParsedMap {
  return { format: "OMAP", version: "Mapper v9", colors: [BLACK, BLUE, YELLOW, GREEN], symbols: new Map(symbols.map(s => [s.id, s])),
    objects, scale: 10_000, georeference: null, bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 }, warnings: [], ...extra };
}

const fills = (calls: Call[]) => calls.filter(call => call.op === "fill").map(call => call.state.fillStyle);
const strokes = (calls: Call[]) => calls.filter(call => call.op === "stroke").map(call => ({ style: call.state.strokeStyle,
  width: call.state.lineWidth, dash: call.state.lineDash }));

describe("drawMap", () => {
  it("ritar i färgordning: högst rank först och rank 0 sist, oberoende av objektens ordning", () => {
    const symbols: MapSymbol[] = [
      { id: "a", kind: "AREA", code: code("401"), name: "Öppen mark", hidden: false, fill: 3, hatches: [] },
      { id: "l", kind: "LINE", code: code("505"), name: "Stig", hidden: false, strokes: [{ color: 1, width: 0.25 }] },
      { id: "w", kind: "AREA", code: code("301"), name: "Sjö", hidden: false, fill: 2, hatches: [], border: [{ color: 1, width: 0.18 }] }
    ];
    const objects: MapObject[] = [
      { kind: "line", symbol: "l", path: [{ type: "M", x: 1, y: 1 }, { type: "L", x: 30, y: 20 }] },
      { kind: "area", symbol: "w", rings: [square(20, 5, 5)], angle: 0 },
      { kind: "area", symbol: "a", rings: [square(0, 0, 10)], angle: 0 }
    ];
    const { ctx, calls } = fakeContext();
    const report = drawMap(ctx, map(symbols, objects), { pxPerMm: 8, origin: { x: -2, y: 32 } });
    // Papperet först, sedan gul (rank 5), blå (rank 1) och svart (rank 0) sist.
    expect(calls[0]?.op).toBe("save");
    expect(calls.find(call => call.op === "fillRect")?.state.fillStyle).toBe("#ffffff");
    expect(fills(calls)).toEqual(["rgba(255, 204, 77, 1)", "rgba(0, 153, 255, 1)"]);
    expect(strokes(calls).map(stroke => stroke.style)).toEqual(["rgba(0, 0, 0, 1)", "rgba(0, 0, 0, 1)"]);
    const lastFill = calls.map(call => call.op).lastIndexOf("fill"), firstStroke = calls.findIndex(call => call.op === "stroke");
    expect(firstStroke).toBeGreaterThan(lastFill);
    expect(report.parts).toBe(3);
  });

  it("sätter transformen mm → pixel med y nedåt och återställer den efteråt", () => {
    const { ctx, calls } = fakeContext();
    drawMap(ctx, map([], []), { pxPerMm: 8, origin: { x: -2, y: 32 } });
    const transforms = calls.filter(call => call.op === "setTransform").map(call => call.args);
    expect(transforms).toContainEqual([8, 0, 0, -8, 16, 256]);
    expect(transforms.at(-1)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(mmToPixel({ pxPerMm: 8, origin: { x: -2, y: 32 } }, { x: 0, y: 0 })).toEqual({ x: 16, y: 256 });
    expect(pixelToMm({ pxPerMm: 8, origin: { x: -2, y: 32 } }, { x: 16, y: 256 })).toEqual({ x: 0, y: 0 });
  });

  it("ritar alla streck i en linje med bredd, streckning och dubbellinjens förskjutning", () => {
    const symbols: MapSymbol[] = [{ id: "road", kind: "LINE", code: code("503"), name: "Väg", hidden: false, strokes: [
      { color: 3, width: 0.3 },
      { color: 1, width: 0.14, offset: 0.22 },
      { color: 1, width: 0.14, offset: -0.22 },
      { color: 1, width: 0.25, dash: [2, 0.25] }
    ] }];
    const { ctx, calls } = fakeContext();
    drawMap(ctx, map(symbols, [{ kind: "line", symbol: "road", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }] }]),
      { pxPerMm: 8, origin: { x: 0, y: 30 } });
    expect(strokes(calls)).toEqual([
      { style: "rgba(255, 204, 77, 1)", width: 0.3, dash: [] },
      { style: "rgba(0, 0, 0, 1)", width: 0.14, dash: [] },
      { style: "rgba(0, 0, 0, 1)", width: 0.14, dash: [] },
      { style: "rgba(0, 0, 0, 1)", width: 0.25, dash: [2, 0.25] }
    ]);
    // Förskjutningen åt vänster i färdriktningen (österut) är norrut, y uppåt.
    const moves = calls.filter(call => call.op === "moveTo").map(call => call.args);
    expect(moves).toContainEqual([0, 0.22]);
    expect(moves).toContainEqual([0, -0.22]);
  });

  it("upprepar punktsymboler längs linjen och vrider dem efter linjen", () => {
    const symbols: MapSymbol[] = [{ id: "cliff", kind: "LINE", code: code("201"), name: "Brant", hidden: false,
      strokes: [{ color: 1, width: 0.35 }],
      repeated: { spacing: 2, elements: [{ kind: "line", color: 1, width: 0.18, path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 0, y: -0.5 }] }] } }];
    const { ctx, calls } = fakeContext();
    drawMap(ctx, map(symbols, [{ kind: "line", symbol: "cliff", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 0, y: 10 }] }]),
      { pxPerMm: 8, origin: { x: 0, y: 30 } });
    const translates = calls.filter(call => call.op === "translate").map(call => call.args);
    expect(translates.map(([, y]) => y)).toEqual([1, 3, 5, 7, 9]);
    const rotations = calls.filter(call => call.op === "rotate").map(call => call.args[0] as number);
    expect(rotations.every(angle => Math.abs(angle - Math.PI / 2) < 1e-9)).toBe(true);
  });

  it("vrider punktsymboler och ritar inte dolda symboler", () => {
    const symbols: MapSymbol[] = [
      { id: "stone", kind: "POINT", code: code("206"), name: "Sten", hidden: false, elements: [{ kind: "dot", color: 1, center: { x: 0, y: 0 }, diameter: 0.4 }] },
      { id: "secret", kind: "POINT", code: code("999"), name: "Dold", hidden: true, elements: [{ kind: "dot", color: 2, center: { x: 0, y: 0 }, diameter: 1 }] }
    ];
    const { ctx, calls } = fakeContext();
    const report = drawMap(ctx, map(symbols, [
      { kind: "point", symbol: "stone", at: { x: 5, y: 6 }, angle: 90 },
      { kind: "point", symbol: "secret", at: { x: 7, y: 7 }, angle: 0 }
    ]), { pxPerMm: 8, origin: { x: 0, y: 30 } });
    expect(fills(calls)).toEqual(["rgba(0, 0, 0, 1)"]);
    expect(calls.find(call => call.op === "translate")?.args).toEqual([5, 6]);
    expect(calls.find(call => call.op === "rotate")?.args[0]).toBeCloseTo(Math.PI / 2);
    expect(report.parts).toBe(1);
  });

  it("ritar raster (hatch) klippt till ytan, punktmönster och tonad yta när mönstret är för tätt", () => {
    const symbols: MapSymbol[] = [
      { id: "marsh", kind: "AREA", code: code("308"), name: "Sank mark", hidden: false, hatches: [{ color: 2, width: 0.1, spacing: 0.4, angle: 0 }] },
      { id: "rocky", kind: "AREA", code: code("209"), name: "Stenig mark", hidden: false, hatches: [],
        pattern: { dx: 2, dy: 2, elements: [{ kind: "dot", color: 1, center: { x: 0, y: 0 }, diameter: 0.2 }] } },
      { id: "dense", kind: "AREA", code: code("412"), name: "Odlad mark", hidden: false, hatches: [],
        pattern: { dx: 0.05, dy: 0.05, elements: [{ kind: "dot", color: 4, center: { x: 0, y: 0 }, diameter: 0.02 }] } }
    ];
    const { ctx, calls } = fakeContext();
    const report = drawMap(ctx, map(symbols, [
      { kind: "area", symbol: "marsh", rings: [square(0, 0, 4)], angle: 0 },
      { kind: "area", symbol: "rocky", rings: [square(10, 10, 4)], angle: 0 },
      { kind: "area", symbol: "dense", rings: [square(20, 0, 20)], angle: 0 }
    ]), { pxPerMm: 8, origin: { x: 0, y: 30 } });
    expect(calls.filter(call => call.op === "clip")).toHaveLength(2);
    expect(strokes(calls)).toContainEqual({ style: "rgba(0, 153, 255, 1)", width: 0.1, dash: [] });
    // Den täta ytan blir en tonad grön yta i stället för 160 000 punkter.
    expect(fills(calls).filter(style => String(style).startsWith("rgba(77, 204, 77"))).toHaveLength(1);
    expect(report.simplifications).toContain("Mönstret för 412 ritas som tonad yta");
    expect(report.simplifications).toContain("Text ritas med standardtypsnitt och vänsterställd");
  });

  it("vrider punktmönstret med mönstrets vinkel plus objektets", () => {
    const symbols: MapSymbol[] = [{ id: "rocky", kind: "AREA", code: code("209"), name: "Stenig mark", hidden: false, hatches: [],
      pattern: { dx: 2, dy: 2, angle: 45, elements: [{ kind: "dot", color: 1, center: { x: 0, y: 0 }, diameter: 0.2 }] } }];
    const { ctx, calls } = fakeContext();
    drawMap(ctx, map(symbols, [{ kind: "area", symbol: "rocky", rings: [square(0, 0, 4)], angle: 15 }]), { pxPerMm: 8, origin: { x: 0, y: 30 } });
    expect(calls.find(call => call.op === "rotate")?.args[0]).toBeCloseTo(60 * Math.PI / 180);
  });

  it("ritar kombinerade symboler med sina delar och text i bildens pixlar", () => {
    const symbols: MapSymbol[] = [
      { id: "fill", kind: "AREA", code: code("301.1"), name: "", hidden: false, fill: 2, hatches: [] },
      { id: "edge", kind: "LINE", code: code("301.2"), name: "", hidden: false, strokes: [{ color: 1, width: 0.18 }] },
      { id: "lake", kind: "COMBINED", code: code("301"), name: "Sjö", hidden: false, parts: ["fill", "edge", "lake"] },
      { id: "name", kind: "TEXT", code: code("999"), name: "Namn", hidden: false, color: 1, size: 2, fontFamily: "Arial", bold: true, italic: false }
    ];
    const { ctx, calls } = fakeContext();
    drawMap(ctx, map(symbols, [
      { kind: "area", symbol: "lake", rings: [square(0, 0, 5)], angle: 0 },
      { kind: "text", symbol: "name", at: { x: 1, y: 29 }, angle: 0, text: "Ön" }
    ]), { pxPerMm: 8, origin: { x: 0, y: 30 } });
    expect(fills(calls)).toEqual(["rgba(0, 153, 255, 1)"]);
    expect(strokes(calls)).toHaveLength(1);
    const text = calls.find(call => call.op === "fillText")!;
    expect(text.args).toEqual(["Ön", 0, 0]);
    expect(text.state.font).toBe('bold 16px "Arial", sans-serif');
    expect(calls.filter(call => call.op === "setTransform").map(call => call.args)).toContainEqual([1, 0, 0, 1, 8, 8]);
  });

  it("hoppar över symboler som saknas och färger som saknas utan fel", () => {
    const symbols: MapSymbol[] = [{ id: "x", kind: "LINE", code: code("1"), name: "", hidden: false, strokes: [{ color: 99, width: 1 }] }];
    const { ctx, calls } = fakeContext();
    const report = drawMap(ctx, map(symbols, [
      { kind: "line", symbol: "x", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 1, y: 1 }] },
      { kind: "point", symbol: "saknas", at: { x: 0, y: 0 }, angle: 0 }
    ]), { pxPerMm: 8, origin: { x: 0, y: 30 } });
    expect(strokes(calls)).toEqual([]);
    expect(report.parts).toBe(1);
    expect(report.simplifications).toContain("Delar i färger som saknas i färgtabellen (t.ex. passmärken) ritas inte");
  });
});

describe("renderSize", () => {
  it("väljer upplösning efter skala", () => {
    expect(preferredPxPerMm(15_000)).toBe(8);
    expect(preferredPxPerMm(10_000)).toBe(8);
    expect(preferredPxPerMm(7_500)).toBe(10);
    expect(preferredPxPerMm(4_000)).toBe(12);
  });

  it("ger bildens storlek och övre vänstra hörn med kant", () => {
    expect(renderSize({ bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 } }, 8)).toEqual({ width: 832, height: 432, pxPerMm: 8,
      origin: { x: -2, y: 52 }, reduced: false });
  });

  it("skalar ned en stor karta till 16 000 px per sida och pixeltaket", () => {
    const wide = renderSize({ bounds: { minX: 0, minY: 0, maxX: 4_000, maxY: 100 } }, 8)!;
    expect(wide.width).toBeLessThanOrEqual(16_000);
    expect(wide.reduced).toBe(true);
    const big = renderSize({ bounds: { minX: 0, minY: 0, maxX: 900, maxY: 700 } }, 8)!;
    expect(big.width * big.height).toBeLessThanOrEqual(28_000_000);
    expect(big.pxPerMm).toBeLessThan(8);
    expect(renderSize({ bounds: null }, 8)).toBeUndefined();
  });
});

describe("geometri", () => {
  it("förskjuter en polylinje med geringsfog i hörnen", () => {
    const line = offsetPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 1);
    expect(line[0]).toEqual({ x: 0, y: 1 });
    expect(line[1]!.x).toBeCloseTo(9);
    expect(line[1]!.y).toBeCloseTo(1);
    expect(line[2]).toEqual({ x: 9, y: 10 });
  });

  it("placerar jämnt längs linjen", () => {
    expect(placementsAlong([{ x: 0, y: 0 }, { x: 4, y: 0 }], 2).map(place => place.at.x)).toEqual([1, 3]);
    expect(placementsAlong([{ x: 0, y: 0 }], 2)).toEqual([]);
  });
});

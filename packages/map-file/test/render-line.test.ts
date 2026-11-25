import { describe, expect, it } from "vitest";
import { drawMap, GAP, type LineSymbol, type MapColor, type MapObject, type MapSymbol, type ParsedMap, type Path, type PointElement } from "../src";
import { cornerPlacements, markedLines, spacedDistances, spacedPlacements } from "../src/render/along";
import { dashIntervals, dashPolylines } from "../src/render/dash";
import { closeRing, withoutGaps } from "../src/render/geometry";
import { fakeContext, type Call } from "./fake-canvas";

const BLACK: MapColor = { id: 1, name: "Svart", rank: 0, cmyk: { c: 0, m: 0, y: 0, k: 1 }, rgb: { r: 0, g: 0, b: 0 }, opacity: 1 };
const BROWN: MapColor = { id: 2, name: "Brun", rank: 1, cmyk: { c: 0, m: 0.5, y: 1, k: 0 }, rgb: { r: 0.8, g: 0.4, b: 0 }, opacity: 1 };
const code = (text: string) => ({ text, main: Number(text.split(".")[0]), sub: Number(text.split(".")[1] ?? 0) });
const tick: PointElement = { kind: "line", color: 1, width: 0.14, path: [{ type: "M", x: 0, y: -0.3 }, { type: "L", x: 0, y: 0.3 }] };
const dot: PointElement = { kind: "dot", color: 1, center: { x: 0, y: 0 }, diameter: 0.3 };

function map(symbols: MapSymbol[], objects: MapObject[]): ParsedMap {
  return { format: "OCD", version: "OCAD 2018.8", colors: [BLACK, BROWN], symbols: new Map(symbols.map(s => [s.id, s])), objects,
    scale: 10_000, georeference: null, bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 }, warnings: [] };
}

function line(extra: Partial<LineSymbol>): LineSymbol {
  return { id: "l", kind: "LINE", code: code("510"), name: "Linje", hidden: false, strokes: [{ color: 1, width: 0.14 }], ...extra };
}

function draw(symbol: MapSymbol, objects: MapObject[]): Call[] {
  const { ctx, calls } = fakeContext();
  drawMap(ctx, map([symbol], objects), { pxPerMm: 8, origin: { x: 0, y: 30 } });
  return calls;
}

const args = (calls: Call[], op: string) => calls.filter(call => call.op === op).map(call => call.args as number[]);
const near = (actual: readonly number[], expected: readonly number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6));
};

describe("linjesymbolernas punktsymboler på skärmen", () => {
  it("ritar kraftledningens stolpar i hörnpunkterna, längs bisektrisen och sträckta i hörnet", () => {
    const calls = draw(line({ corner: { elements: [tick], stretch: true } }), [{ kind: "line", symbol: "l", path: [
      { type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0, corner: true }, { type: "L", x: 10, y: 10 }, { type: "L", x: 20, y: 10, corner: true }
    ] }]);
    expect(args(calls, "translate")).toEqual([[10, 0], [20, 10]]);
    // Rakt österut och sedan norrut: bisektrisen ligger i 45°, tvärstrecket sträcks √2 gånger. I änden ingen sträckning.
    near(args(calls, "rotate").map(([angle]) => angle!), [Math.PI / 4]);
    near(args(calls, "scale")[0]!, [1, Math.SQRT2]);
    expect(args(calls, "scale")).toHaveLength(1);
    expect(calls.filter(call => call.op === "stroke")).toHaveLength(3);
  });

  it("sträcker högst tre gånger och hoppar över ändarna när symbolen säger så", () => {
    const sharp = markedLines([{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0, corner: true }, { type: "L", x: 0, y: 0.5, corner: true }])[0]!;
    const places = cornerPlacements(sharp, true, false);
    expect(places).toHaveLength(2);
    expect(places[0]!.stretch).toBe(3);
    expect(places[1]!.stretch).toBe(1);
    expect(cornerPlacements(sharp, true, true)).toHaveLength(1);
    expect(cornerPlacements(sharp, false, false)[0]!.stretch).toBe(1);
  });

  it("ritar start- och slutsymbolen i linjens riktning (brons vingar)", () => {
    const calls = draw(line({ start: { elements: [tick] }, end: { elements: [dot] } }), [{ kind: "line", symbol: "l", path: [
      { type: "M", x: 0, y: 0 }, { type: "L", x: 0, y: 10 }, { type: "L", x: 5, y: 10 }
    ] }]);
    expect(args(calls, "translate")).toEqual([[0, 0], [5, 10]]);
    near(args(calls, "rotate").map(([angle]) => angle!), [Math.PI / 2]);
  });

  it("fördelar upprepade symboler jämnt från slutlängden och i par (518)", () => {
    const fence = line({ repeated: { elements: [tick], spacing: 2.5, endLength: 1.25, count: 2, groupSpacing: 0.6, minimum: 1 } });
    const calls = draw(fence, [{ kind: "line", symbol: "l", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }] }]);
    near(args(calls, "translate").map(([x]) => x!), [0.95, 1.55, 3.45, 4.05, 5.95, 6.55, 8.45, 9.05]);
  });

  it("justerar avståndet så att det går jämnt ut och lägger en ensam symbol mitt på", () => {
    near(spacedDistances(10, 3, 1.5, 1), [5 / 3, 5, 25 / 3]);
    near(spacedDistances(10.5, 2, 1, 1), [1.05, 3.15, 5.25, 7.35, 9.45]);
    near(spacedDistances(2, 3, 1.5, 1), [1]);
    expect(spacedDistances(1, 3, 1.5, 0)).toEqual([]);
    near(spacedDistances(1, 3, 0.5, 0), [0.5]);
    // Utan slutlängd hamnar symbolerna i ändarna och jämnt emellan (prickad linje).
    near(spacedDistances(1.8, 0.45, 0, 1), [0, 0.45, 0.9, 1.35, 1.8]);
    expect(spacedDistances(0, 3, 1, 1)).toEqual([]);
  });

  it("börjar om mönstret i hörn- och streckpunkter, med minsta antalet bara på längsta delen", () => {
    const path: Path = [{ type: "M", x: 0, y: 0 }, { type: "L", x: 4, y: 0, dash: true }, { type: "L", x: 10, y: 0 }];
    const places = spacedPlacements(markedLines(path)[0]!, { elements: [dot], spacing: 3, endLength: 1.5, minimum: 1 });
    near(places.map(place => place.at.x), [2, 5.5, 8.5]);
    const short: Path = [{ type: "M", x: 0, y: 0 }, { type: "L", x: 1, y: 0, corner: true }, { type: "L", x: 10, y: 0 }];
    near(spacedPlacements(markedLines(short)[0]!, { elements: [dot], spacing: 3, endLength: 2, minimum: 1 }).map(place => place.at.x), [2.8, 5.5, 8.2]);
  });

  it("ritar sekundärsymbolen mitt emellan primärsymbolerna", () => {
    const calls = draw(line({ between: { elements: [dot], spacing: 2, endLength: 1 } }), [{ kind: "line", symbol: "l", path: [
      { type: "M", x: 0, y: 0 }, { type: "L", x: 8, y: 0 }
    ] }]);
    near(args(calls, "translate").map(([x]) => x!), [2, 4, 6]);
  });

  it("följer kurvor och vrider symbolerna efter kurvan", () => {
    const curve: Path = [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 0, y1: 5, x2: 5, y2: 10, x: 10, y: 10 }];
    const places = spacedPlacements(markedLines(curve)[0]!, { elements: [dot], spacing: 100, endLength: 0, minimum: 1 });
    expect(places).toHaveLength(1);
    expect(places[0]!.angle).toBeGreaterThan(0.3);
    expect(places[0]!.angle).toBeLessThan(1.3);
  });
});

describe("luckor i linjer", () => {
  it("ritar inte huvudlinjen i luckan men kantlinjerna, och tvärtom", () => {
    const road = line({ strokes: [{ color: 2, width: 0.4 }, { color: 1, width: 0.1, offset: 0.25 }, { color: 1, width: 0.1, offset: -0.25 }] });
    const calls = draw(road, [{ kind: "line", symbol: "l", path: [
      { type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 20, y: 0, gap: GAP.main }, { type: "L", x: 30, y: 0, gap: GAP.left }
    ] }]);
    // Huvudlinjen: 0–10 och 20–30. Vänster kantlinje: 0–20. Höger: hela vägen.
    const strokes = calls.reduce<{ moves: number[][]; lines: number[][] }[]>((list, call) => {
      if (call.op === "beginPath") list.push({ moves: [], lines: [] });
      else if (call.op === "moveTo") list.at(-1)!.moves.push(call.args as number[]);
      else if (call.op === "lineTo") list.at(-1)!.lines.push(call.args as number[]);
      return list;
    }, []).filter(path => path.moves.length > 0);
    const [main, left, right] = strokes;
    expect(main!.moves).toEqual([[0, 0], [20, 0]]);
    expect(main!.lines).toEqual([[10, 0], [30, 0]]);
    expect(left!.moves.map(([, y]) => y)).toEqual([0.25]);
    expect(left!.lines.map(([x]) => x)).toEqual([10, 20]);
    expect(right!.lines.map(([x]) => x)).toEqual([10, 20, 30]);
  });

  it("tar bort sträckor med luckan och tomma flyttningar", () => {
    const path: Path = [{ type: "M", x: 0, y: 0 }, { type: "L", x: 1, y: 0, gap: GAP.main }, { type: "L", x: 2, y: 0, gap: GAP.main },
      { type: "L", x: 3, y: 0 }];
    expect(withoutGaps(path, GAP.main)).toEqual([{ type: "M", x: 2, y: 0 }, { type: "L", x: 3, y: 0 }]);
    expect(withoutGaps(path, GAP.left)).toBe(path);
  });

  it("stänger ytans ring för kantlinjen, med luckan på den stängande sträckan", () => {
    const ring: Path = [{ type: "M", x: 0, y: 0, gap: GAP.main }, { type: "L", x: 4, y: 0 }, { type: "L", x: 4, y: 4 }];
    expect(closeRing(ring).at(-1)).toEqual({ type: "L", x: 0, y: 0, gap: GAP.main });
    expect(withoutGaps(closeRing(ring), GAP.main)).toEqual(ring);
    const border: MapSymbol = { id: "a", kind: "AREA", code: code("521"), name: "Byggnad", hidden: false, fill: 2, hatches: [],
      border: [{ color: 1, width: 0.14 }] };
    const calls = draw(border, [{ kind: "area", symbol: "a", angle: 0, rings: [[{ type: "M", x: 0, y: 0 }, { type: "L", x: 4, y: 0 }, { type: "L", x: 4, y: 4 }]] }]);
    // Ytan fylls (tre punkter) och kanten ritas runt hela, tillbaka till början.
    expect(args(calls, "lineTo").slice(-3)).toEqual([[4, 0], [4, 4], [0, 0]]);
  });
});

describe("anpassad streckning i hörn- och streckpunkter (styrpunkter)", () => {
  it("skalar streck och mellanrum jämnt och ritar korta delsträckor heldragna", () => {
    // Halvt ändstreck (1 mm) + gap (0,5 mm) + helt (2 mm) + gap (0,5 mm) + halvt ändstreck (1 mm) = 5 mm.
    expect(dashIntervals(5, { mainLength: 2, mainGap: 0.5, endLength: 1 })).toEqual([[0, 1], [1.5, 3.5], [4, 5]]);
    // Kort delsträcka (<= 2 * endLength): ett enda heldraget streck utan mellanrum.
    expect(dashIntervals(1.8, { mainLength: 2, mainGap: 0.5, endLength: 1 })).toEqual([[0, 1.8]]);
    // Sekundärt mellanrum delar mittstrecken.
    expect(dashIntervals(5, { mainLength: 2, mainGap: 0.5, endLength: 1, secondaryGap: 0.4 })).toEqual([[0, 1], [1.5, 2.3], [2.7, 3.5], [4, 5]]);
  });

  it("delar linjen i styrpunkter så att varje brytpunkt och ände hamnar på ett heldraget streck", () => {
    const path: Path = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 5, y: 0, dash: true },
      { type: "L", x: 5, y: 2.5, corner: true },
      { type: "L", x: 10, y: 2.5 }
    ];
    const spec = { mainLength: 2, mainGap: 0.5, endLength: 1 };
    const pieces = dashPolylines([path], spec);
    // Del 1 (0..5): [0..1], [1.5..3.5], [4..5] → landar på (5, 0).
    // Del 2 (0..2,5 längs y): [0..1], [1.5..2.5] → startar i (5, 0) och landar i (5, 2.5).
    // Del 3 (5..10 längs x): [5..6], [6.5..8.5], [9..10] → startar i (5, 2.5) och landar i (10, 2.5).
    expect(pieces).toHaveLength(8);
    expect(pieces[0]![0]).toEqual({ x: 0, y: 0 });
    expect(pieces[2]!.at(-1)).toEqual({ x: 5, y: 0 });
    expect(pieces[3]![0]).toEqual({ x: 5, y: 0 });
    expect(pieces[4]!.at(-1)).toEqual({ x: 5, y: 2.5 });
    expect(pieces[5]![0]).toEqual({ x: 5, y: 2.5 });
    expect(pieces[7]!.at(-1)).toEqual({ x: 10, y: 2.5 });

    // `drawMap` ritar delstrecken med tom setLineDash så att Canvas och PDF ger exakt samma geometri.
    const dashedLine = line({ strokes: [{ color: 1, width: 0.25, dash: [2, 0.5], dashSpec: spec }] });
    const calls = draw(dashedLine, [{ kind: "line", symbol: "l", path }]);
    const strokeCall = calls.find(call => call.op === "stroke");
    expect(strokeCall?.state.lineDash).toEqual([]);
    expect(args(calls, "moveTo")).toHaveLength(8);
  });
});

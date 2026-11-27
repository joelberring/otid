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

  it("tar bort sträckor med luckan och tomma flyttningar, men behåller hörn- och streckflaggor", () => {
    const path: Path = [{ type: "M", x: 0, y: 0 }, { type: "L", x: 1, y: 0, gap: GAP.main }, { type: "L", x: 2, y: 0, gap: GAP.main, corner: true, dash: true },
      { type: "L", x: 3, y: 0 }];
    expect(withoutGaps(path, GAP.main)).toEqual([{ type: "M", x: 2, y: 0, corner: true, dash: true }, { type: "L", x: 3, y: 0 }]);
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
    // Kort delsträcka (<= (startLen + endLen) / 2): ett enda heldraget streck utan mellanrum.
    expect(dashIntervals(0.9, { mainLength: 2, mainGap: 0.5, endLength: 1 })).toEqual([[0, 0.9]]);
    // Delsträcka > (startLen + endLen) / 2 men <= startLen + endLen får fortfarande ett skalat mellanrum.
    near(dashIntervals(1.8, { mainLength: 2, mainGap: 0.5, endLength: 1 }).flat(), [0, 0.72, 1.08, 1.8]);
    // Sekundärt mellanrum delar mittstrecken.
    expect(dashIntervals(5, { mainLength: 2, mainGap: 0.5, endLength: 1, secondaryGap: 0.4 })).toEqual([[0, 1], [1.5, 2.3], [2.7, 3.5], [4, 5]]);
  });

  it("delar linjen i styrpunkter och syr ihop halva streck till ett enda streck runt varje brytpunkt", () => {
    const path: Path = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 5, y: 0, dash: true },
      { type: "L", x: 5, y: 2.5, corner: true },
      { type: "L", x: 10, y: 2.5 }
    ];
    const spec = { mainLength: 2, mainGap: 0.5, endLength: 1 };
    const pieces = dashPolylines([path], spec);
    // Del 1 (0..5): [0..1], [1.5..3.5], [4..5] → sys ihop med del 2:s [0..1] vid (5, 0).
    // Del 2 (0..2,5 längs y): [0..1], [1.5..2.5] → sys ihop med del 3:s [5..6] vid (5, 2.5).
    // Del 3 (5..10 längs x): [5..6], [6.5..8.5], [9..10].
    expect(pieces).toHaveLength(6);
    expect(pieces[0]![0]).toEqual({ x: 0, y: 0 });
    expect(pieces[2]).toEqual([{ x: 4, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 1 }]);
    expect(pieces[3]).toEqual([{ x: 5, y: 1.5 }, { x: 5, y: 2.5 }, { x: 6, y: 2.5 }]);
    expect(pieces[5]!.at(-1)).toEqual({ x: 10, y: 2.5 });

    // `drawMap` ritar delstrecken med tom setLineDash så att Canvas och PDF ger exakt samma geometri.
    const dashedLine = line({ strokes: [{ color: 1, width: 0.25, dash: [2, 0.5], dashSpec: spec }] });
    const calls = draw(dashedLine, [{ kind: "line", symbol: "l", path }]);
    const strokeCall = calls.find(call => call.op === "stroke");
    expect(strokeCall?.state.lineDash).toEqual([]);
    expect(args(calls, "moveTo")).toHaveLength(6);
  });

  it("ger inre styrpunkt ett halvt streck (mainLength/2) på vardera sidan, hopfogat till ett streck med längd ~mainLength", () => {
    // Typisk hjälpkurva: mainLength = 2, mainGap = 0.2, endLength = 2 (fullt streck i öppna ändar).
    const spec = { mainLength: 2, mainGap: 0.2, endLength: 2 };
    const path: Path = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 5.4, y: 0, corner: true },
      { type: "L", x: 5.4, y: 5.4 }
    ];
    const pieces = dashPolylines([path], spec);
    // Varje delsträcka 5,4 mm: openEnd(2) + gap(0,2) + full(2) + gap(0,2) + half(1) = 5,4 mm → scale = 1.
    // Styrpunkten (5,4, 0) får ETT hopfogat streck: (4,4, 0) → (5,4, 0) → (5,4, 1,0), totallängd 2,0 mm, med mellanrum på båda sidor.
    expect(pieces).toHaveLength(5);
    expect(pieces[0]).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }]);
    const bend = pieces[2]!;
    expect(bend).toHaveLength(3);
    expect(bend[0]!.x).toBeCloseTo(4.4, 6);
    expect(bend[0]!.y).toBeCloseTo(0, 6);
    expect(bend[1]).toEqual({ x: 5.4, y: 0 });
    expect(bend[2]!.x).toBeCloseTo(5.4, 6);
    expect(bend[2]!.y).toBeCloseTo(1, 6);
    expect(pieces[4]![0]!.y).toBeCloseTo(3.4, 6);
    expect(pieces[4]!.at(-1)).toEqual({ x: 5.4, y: 5.4 });
  });

  it("lägger ett mellanrum mitt på en kort delsträcka (2,2 mm) mellan två styrpunkter", () => {
    const spec = { mainLength: 2, mainGap: 0.2, endLength: 2 };
    near(dashIntervals(2.2, spec, true, true).flat(), [0, 1, 1.2, 2.2]);
    const path: Path = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 5.4, y: 0, dash: true },
      { type: "L", x: 7.6, y: 0, dash: true },
      { type: "L", x: 13.0, y: 0 }
    ];
    const pieces = dashPolylines([path], spec);
    // Del 2 (5,4..7,6 = 2,2 mm) får [5,4..6,4] och [6,6..7,6] → ett tydligt mellanrum [6,4..6,6] i mitten!
    expect(pieces).toHaveLength(6);
    expect(pieces[2]![0]!.x).toBeCloseTo(4.4, 6);
    expect(pieces[2]!.at(-1)!.x).toBeCloseTo(6.4, 6);
    expect(pieces[3]![0]!.x).toBeCloseTo(6.6, 6);
    expect(pieces[3]!.at(-1)!.x).toBeCloseTo(8.6, 6);
  });

  it("streckar sluten slinga (knöl/sänka) med två styrpunkter så att båda får hopfogade streck utan skarv vid P0", () => {
    // Rektangel 4,4 × 2,2 mm (omkrets 13,2 mm), styrpunkter i två motstående hörn (ej P0!).
    const spec = { mainLength: 2, mainGap: 0.2, endLength: 2 };
    const loop: Path = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 4.4, y: 0, corner: true },
      { type: "L", x: 4.4, y: 2.2 },
      { type: "L", x: 0, y: 2.2, corner: true },
      { type: "L", x: 0, y: 0 }
    ];
    const pieces = dashPolylines([loop], spec);
    // Två delsträckor om 6,6 mm (= 3 perioder à 2,2 mm) → 6 streck totalt, båda hörnen (4,4, 0) och (0, 2,2) centrerade i varsitt hopfogat streck.
    expect(pieces).toHaveLength(6);
    const lengthOf = (poly: readonly { x: number; y: number }[]) =>
      poly.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - poly[i]!.x, p.y - poly[i]!.y), 0);
    for (const poly of pieces) expect(lengthOf(poly)).toBeCloseTo(2, 5);
    const atCorner1 = pieces.filter(poly => poly.some(p => Math.abs(p.x - 4.4) < 1e-6 && Math.abs(p.y - 0) < 1e-6));
    const atCorner2 = pieces.filter(poly => poly.some(p => Math.abs(p.x - 0) < 1e-6 && Math.abs(p.y - 2.2) < 1e-6));
    expect(atCorner1).toHaveLength(1);
    expect(atCorner2).toHaveLength(1);
    // Hörn 1 ligger mitt i sitt streck (varken första eller sista punkt).
    expect(atCorner1[0]!.length).toBeGreaterThanOrEqual(3);
    expect(atCorner2[0]!.length).toBeGreaterThanOrEqual(3);
  });

  it("streckar sluten slinga utan styrpunkter jämnt runt hela ringen och syr ihop över P0", () => {
    // Kvadrat 2,5 × 2,5 mm (omkrets 10 mm), mainLength = 2, mainGap = 0,5 → 4 lika streck om 2,0 mm.
    const spec = { mainLength: 2, mainGap: 0.5, endLength: 2 };
    const loop: Path = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 2.5, y: 0 },
      { type: "L", x: 2.5, y: 2.5 },
      { type: "L", x: 0, y: 2.5 },
      { type: "L", x: 0, y: 0 }
    ];
    const pieces = dashPolylines([loop], spec);
    expect(pieces).toHaveLength(4);
    const lengthOf = (poly: readonly { x: number; y: number }[]) =>
      poly.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - poly[i]!.x, p.y - poly[i]!.y), 0);
    for (const poly of pieces) expect(lengthOf(poly)).toBeCloseTo(2, 5);
    // Strecket över P0 (0, 0) är hopfogat: (0, 1) → (0, 0) → (1, 0).
    expect(pieces[0]).toEqual([{ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }]);
  });

  it("ger en liten sluten hjälpkurveknöl (1 styrpunkt, 2,4 mm omkrets) minst två streck och två mellanrum", () => {
    const spec = { mainLength: 2, mainGap: 0.2, endLength: 2 };
    const knoll: Path = [
      { type: "M", x: 0, y: 0, dash: true },
      { type: "L", x: 0.8, y: 0 },
      { type: "L", x: 0.8, y: 0.4 },
      { type: "L", x: 0, y: 0.4 },
      { type: "L", x: 0, y: 0 }
    ];
    const pieces = dashPolylines([knoll], spec);
    // Omkrets 2,4 mm: får 2 jämna streck och 2 mellanrum i stället för att kollapsa till en heldragen ring.
    expect(pieces).toHaveLength(2);
  });

  it("delar även öppna ändstreck med sekundärt mellanrum när endLength == mainLength (t.ex. 507.0)", () => {
    const spec = { mainLength: 2.25, mainGap: 0.8, endLength: 2.25, secondaryGap: 0.25 };
    // 2,25 + 0,8 + 2,25 = 5,3 mm → scale = 1, båda öppna ändstrecken delas i [1,0 + 0,25 + 1,0].
    near(dashIntervals(5.3, spec, false, false).flat(), [0, 1, 1.25, 2.25, 3.05, 4.05, 4.3, 5.3]);
    // Inre halvt streck delas aldrig av sekundärt mellanrum.
    near(dashIntervals(3.05, spec, true, true).flat(), [0, 1.125, 1.925, 3.05]);
  });

  it("streckar korta 507.0/506.0/505.0/103.0-delsträckor över (startLen + endLen) / 2 i stället för att göra dem heldragna", () => {
    // 507.0 (3,72 mm O-O): 1 huvudmellanrum + 2 sekundära mellanrum = 4 streck.
    const spec507 = { mainLength: 2.25, mainGap: 0.8, endLength: 2.25, secondaryGap: 0.25 };
    expect(dashIntervals(3.72, spec507, false, false)).toHaveLength(4);
    // 505.0 (2,94 mm O-O) och 506.0 (1,93 mm O-O): 2 streck (1 mellanrum).
    expect(dashIntervals(2.94, { mainLength: 2, mainGap: 0.25, endLength: 2 }, false, false)).toHaveLength(2);
    expect(dashIntervals(1.93, { mainLength: 1, mainGap: 0.25, endLength: 1 }, false, false)).toHaveLength(2);
    // 103.0: I-I över 1,0 mm får mellanrum, under 1,0 mm hålls heldragna; O-O under 2,0 mm hålls heldragen; I-O över 1,5 mm får mellanrum.
    const spec103 = { mainLength: 2, mainGap: 0.2, endLength: 2 };
    expect(dashIntervals(1.13, spec103, true, true)).toHaveLength(2);
    expect(dashIntervals(1.78, spec103, true, true)).toHaveLength(2);
    expect(dashIntervals(0.92, spec103, true, true)).toHaveLength(1);
    expect(dashIntervals(1.86, spec103, true, false)).toHaveLength(2);
    expect(dashIntervals(1.46, spec103, false, false)).toHaveLength(1);
  });

  it("linjär segmentpekare i dashPolylines och spacedPlacements ger bit-identisk utdata mot O(N*M)-referens", () => {
    // Vågig polylinje med 180 segment, styrpunkter och noll-längdssegment på kurva.
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 180; i += 1) pts.push({ x: i * 0.45, y: Math.sin(i * 0.25) * 2.5 });
    const path: Path = pts.map((p, index) => ({
      type: index === 0 ? "M" as const : "L" as const,
      x: p.x,
      y: p.y,
      ...(index === 60 ? { dash: true as const } : {}),
      ...(index === 120 ? { corner: true as const } : {})
    }));
    const spec = { mainLength: 2.25, mainGap: 0.6, endLength: 1.5, secondaryGap: 0.25 };

    // Referensimplementation av slicePolyline med omstart från seg = 0 varje intervall.
    const refDash = (input: Path): { x: number; y: number }[][] => {
      const EPS = 1e-6;
      const ml = markedLines(input)[0]!;
      const stops = [0, ...ml.breaks.filter(i => i > 0 && i < ml.points.length - 1).sort((a, b) => a - b), ml.points.length - 1];
      const out: { x: number; y: number }[][] = [];
      let prevEndedAtStop = false;
      for (let s = 1; s < stops.length; s += 1) {
        const piece = ml.points.slice(stops[s - 1], stops[s]! + 1);
        const cum: number[] = [0];
        for (let i = 1; i < piece.length; i += 1) cum.push(cum[i - 1]! + Math.hypot(piece[i]!.x - piece[i - 1]!.x, piece[i]!.y - piece[i - 1]!.y));
        const total = cum[cum.length - 1]!;
        const intervals = dashIntervals(total, spec, s > 1, s < stops.length - 1, 1);
        let endedAtStop = false;
        for (let k = 0; k < intervals.length; k += 1) {
          const [d0, d1] = intervals[k]!;
          const sliced: { x: number; y: number }[] = [];
          const pushPt = (p: { x: number; y: number }) => {
            const last = sliced[sliced.length - 1];
            if (!last || Math.hypot(p.x - last.x, p.y - last.y) > EPS) sliced.push(p);
          };
          const interp = (dist: number, seg: number) => {
            const segLen = cum[seg + 1]! - cum[seg]!;
            const t = segLen > 0 ? Math.min(1, Math.max(0, (dist - cum[seg]!) / segLen)) : 0;
            const a = piece[seg]!, b = piece[seg + 1]!;
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          };
          let seg = 0;
          while (seg < cum.length - 2 && cum[seg + 1]! < d0 - EPS) seg += 1;
          pushPt(interp(d0, seg));
          while (seg < cum.length - 2 && cum[seg + 1]! < d1 - EPS) { seg += 1; pushPt(piece[seg]!); }
          pushPt(interp(d1, seg));
          if (sliced.length < 2) continue;
          const prev = out[out.length - 1];
          if (k === 0 && d0 <= EPS && prevEndedAtStop && prev && Math.hypot(prev[prev.length - 1]!.x - sliced[0]!.x, prev[prev.length - 1]!.y - sliced[0]!.y) <= EPS) {
            prev.push(...sliced.slice(1));
          } else {
            out.push(sliced);
          }
          if (k === intervals.length - 1 && d1 >= total - EPS) endedAtStop = true;
        }
        prevEndedAtStop = endedAtStop;
      }
      return out;
    };

    expect(dashPolylines([path], spec)).toEqual(refDash(path));

    // Referensimplementation av spacedPlacements med omstart från segment = 0 varje punkt, inkl. överlappande groupSpacing.
    const ml = markedLines(path)[0]!;
    for (const rep of [
      { elements: [dot], spacing: 1.5, endLength: 0.75, count: 2, groupSpacing: 0.4, minimum: 1 },
      { elements: [dot], spacing: 0.8, endLength: 0.2, count: 3, groupSpacing: 1.2, minimum: 1 },
      { elements: [dot], spacing: 1.2, endLength: 0.5, count: 2, groupSpacing: -0.5, minimum: 1 }
    ]) {
      const actual = spacedPlacements(ml, rep, false, 10_000);
      const stops = [0, ...ml.breaks.filter(i => i > 0 && i < ml.points.length - 1).sort((a, b) => a - b), ml.points.length - 1];
      const parts = stops.slice(1).map((to, idx) => {
        const part = ml.points.slice(stops[idx], to + 1);
        const lengths = part.slice(1).map((p, i) => Math.hypot(p.x - part[i]!.x, p.y - part[i]!.y));
        return { points: part, lengths, total: lengths.reduce((a, b) => a + b, 0) };
      });
      const longest = parts.reduce((best, p, i) => (p.total > parts[best]!.total ? i : best), 0);
      const expected: { at: { x: number; y: number }; angle: number; stretch: number }[] = [];
      parts.forEach((part, idx) => {
        const distances = spacedDistances(part.total, rep.spacing, rep.endLength, idx === longest ? rep.minimum : 0);
        for (const d of distances) {
          for (let k = 0; k < rep.count; k += 1) {
            const target = Math.min(Math.max(d + (k - (rep.count - 1) / 2) * rep.groupSpacing, 0), part.total);
            let start = 0, seg = 0;
            while (seg < part.lengths.length - 1 && start + part.lengths[seg]! < target) { start += part.lengths[seg]!; seg += 1; }
            const a = part.points[seg]!, b = part.points[seg + 1]!;
            const t = part.lengths[seg]! > 0 ? (target - start) / part.lengths[seg]! : 0;
            expected.push({ at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle: Math.atan2(b.y - a.y, b.x - a.x), stretch: 1 });
          }
        }
      });
      expect(actual).toEqual(expected);
    }
  });

  it("lineDecorations bevarar start/slut över luckor och återanvänder vägen utan luckor", () => {
    const sym = line({
      repeated: { elements: [dot], spacing: 2, endLength: 1 },
      start: { elements: [tick] },
      end: { elements: [tick] }
    });
    const plainPath: Path = [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }];
    const gappedPath: Path = [{ type: "M", x: 0, y: 0 }, { type: "L", x: 4, y: 0, gap: GAP.main }, { type: "L", x: 10, y: 0 }];
    const callsPlain = draw(sym, [{ kind: "line", symbol: "l", path: plainPath }]);
    const callsGapped = draw(sym, [{ kind: "line", symbol: "l", path: gappedPath }]);
    // Start (0,0) och slut (10,0) ritas även när första delsträckan har GAP.main, medan upprepade bara ligger på 4..10.
    const translatesGapped = args(callsGapped, "translate");
    expect(translatesGapped).toContainEqual([0, 0]);
    expect(translatesGapped).toContainEqual([10, 0]);
    expect(translatesGapped.filter(([x]) => x! > 0 && x! < 4)).toHaveLength(0);
    expect(args(callsPlain, "translate")).toContainEqual([0, 0]);
    expect(args(callsPlain, "translate")).toContainEqual([10, 0]);
  });
});

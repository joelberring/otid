import { describe, expect, it } from "vitest";
import { colorUsage, drawMap, GAP, readMapFile, type AreaSymbol, type LineSymbol, type PointSymbol, type TextSymbol } from "../src";
import { AREA, COORD_FLAG, ELEMENT_TYPE, LINE, OBJECT_TYPE, SYMBOL_TYPE, TEXT } from "../src/ocd/layout";
import { lineDecorations } from "../src/render/along";
import { fakeContext } from "./fake-canvas";
import { buildOcd, concat, element, ocdCoord, symbolBody } from "./ocd-builder";

const COLORS = [
  { type: 9, value: "Svart\tn1\tc0\tm0\ty0\tk100" },
  { type: 9, value: "Vit\tn2\tc0\tm0\ty0\tk0" },
  { type: 1039, value: "\tm15000" }
];

function elementWithFlags(
  type: number, flags: number, color: number, lineWidth: number, diameter: number, coords: ReturnType<typeof ocdCoord>[]
): Uint8Array {
  const buf = element(type, color, lineWidth, diameter, coords);
  new DataView(buf.buffer).setUint16(2, flags, true);
  return buf;
}

describe("OCAD-symboler och dekorationer (fixar #3–#8)", () => {
  it("#3: linjedekorationer (repeated, between, corner) hoppar över GAP.main men behåller start/slut på ursprungsvägen", () => {
    const tick = [{ kind: "line" as const, color: 1, width: 0.14, path: [{ type: "M" as const, x: 0, y: 0 }, { type: "L" as const, x: 0, y: -0.4 }] }];
    const line: LineSymbol = {
      id: "518000", code: { text: "518.0", main: 518, sub: 0 }, name: "Staket", hidden: false, kind: "LINE",
      strokes: [{ color: 1, width: 0.25 }],
      repeated: { elements: tick, spacing: 2, endLength: 1, count: 1, minimum: 1 },
      between: { elements: tick, spacing: 2, endLength: 1, minimum: 1 },
      corner: { elements: tick, stretch: false },
      start: { elements: tick },
      end: { elements: tick }
    };
    // Segment 0→10 (solid), 10→20 (GAP.main), 20→30 (solid). Hörn i x=15 inuti luckan (dubbel lucka) och i x=5.
    const path = [
      { type: "M" as const, x: 0, y: 0 },
      { type: "L" as const, x: 10, y: 0 },
      { type: "L" as const, x: 15, y: 0, gap: GAP.main, corner: true as const },
      { type: "L" as const, x: 20, y: 0, gap: GAP.main },
      { type: "L" as const, x: 30, y: 0 }
    ];
    const groups = lineDecorations(line, [path], 1000);
    expect(groups).toHaveLength(4); // repeated, between, start, end (hörnet vid x=15 ligger helt i luckan och hoppas över)
    const [repeated, between, start, end] = groups;
    for (const place of [...repeated!.places, ...between!.places]) {
      expect(place.at.x < 10.001 || place.at.x > 19.999).toBe(true);
    }
    // Start och slut ritas bara en gång vid ursprungsvägens ändar (x=0 och x=30), inte vid luckans kanter.
    expect(start!.places).toHaveLength(1);
    expect(start!.places[0]!.at.x).toBeCloseTo(0);
    expect(end!.places).toHaveLength(1);
    expect(end!.places[0]!.at.x).toBeCloseTo(30);
  });

  it("#4: oregelbundet ytmönster (StructDraw = 3, VarX/VarY) läses och ritas med deterministisk slumpförskjutning", () => {
    const dot = element(ELEMENT_TYPE.dot, 1, 0, 20, [ocdCoord(0, 0)]);
    const body = concat(
      symbolBody(AREA.elements - 796, {
        [AREA.structureWidth]: 100,
        [AREA.structureHeight]: 100,
        [AREA.structureMinDist]: 25,
        [AREA.dataSize]: dot.length / 8
      }, view => {
        view.setUint8(AREA.structureMode - 796, 1);
        view.setUint8(AREA.structureDraw - 796, 3);
        view.setUint8(AREA.structureVarX - 796, 100);
        view.setUint8(AREA.structureVarY - 796, 80);
      }),
      dot
    );
    const map = readMapFile(buildOcd({
      strings: COLORS,
      symbols: [{ number: 113000, type: SYMBOL_TYPE.area, body }],
      objects: [{
        symbol: 113000, type: OBJECT_TYPE.area,
        coords: [ocdCoord(0, 0), ocdCoord(400, 0), ocdCoord(400, 400), ocdCoord(0, 400)]
      }]
    }));
    const sym = map.symbols.get("113000") as AreaSymbol;
    expect(sym.pattern?.irregular).toEqual({ jitterX: 0.5, jitterY: 0.4, minDist: 0.25 });

    const run = () => {
      const { ctx, calls } = fakeContext(100, 100);
      drawMap(ctx, map, { pxPerMm: 10, origin: { x: 0, y: 4 } });
      return calls.filter(call => call.op === "translate").map(call => call.args as [number, number]);
    };
    const first = run();
    const second = run();
    expect(first.length).toBeGreaterThan(4);
    expect(first).toEqual(second); // deterministisk
    // Minst en punkt har förskjutits från det raka 1 mm-rutnätet.
    expect(first.some(([x, y]) => Math.abs(x - Math.round(x)) > 1e-3 || Math.abs(y - Math.round(y)) > 1e-3)).toBe(true);
  });

  it("#5: OCAD textjustering, radavstånd, kontur (FrMode = 2) och formaterad text (typ 5) övre-vänster ankare", () => {
    const body = symbolBody(TEXT.framingEnd - 796, {
      [TEXT.color]: 1,
      [TEXT.fontSize]: 100,
      [TEXT.fontWeight]: 700,
      [TEXT.alignment]: 1 | 4, // center + middle
      [TEXT.lineSpace]: 135,
      [TEXT.frColor]: 2,
      [TEXT.frWidth]: 15
    }, view => {
      const name = "Arial";
      view.setUint8(0, name.length);
      for (let i = 0; i < name.length; i++) view.setUint8(1 + i, name.charCodeAt(i));
      view.setUint8(TEXT.frMode - 796, 2);
    });
    const map = readMapFile(buildOcd({
      strings: COLORS,
      symbols: [{ number: 102003, type: SYMBOL_TYPE.text, body }],
      objects: [{
        symbol: 102003, type: OBJECT_TYPE.formattedText,
        // 0 = nedre vänstra, 1 = nedre högra, 2 = övre högra, 3 = övre vänstra
        coords: [ocdCoord(100, 200), ocdCoord(500, 200), ocdCoord(500, 400), ocdCoord(100, 400)],
        text: "Rad 1\r\nRad 2"
      }]
    }));
    const sym = map.symbols.get("102003") as TextSymbol;
    expect(sym.align).toBe("center");
    expect(sym.baseline).toBe("middle");
    expect(sym.lineSpacing).toBeCloseTo(1.35);
    expect(sym.framing).toEqual({ color: 2, width: 0.3 });

    const obj = map.objects[0]!;
    expect(obj.kind).toBe("text");
    if (obj.kind === "text") expect(obj.at).toEqual({ x: 1, y: 4 }); // coords[3]

    const { ctx, calls } = fakeContext(100, 100);
    drawMap(ctx, map, { pxPerMm: 10, origin: { x: 0, y: 10 } });
    const strokes = calls.filter(call => call.op === "strokeText");
    const fills = calls.filter(call => call.op === "fillText");
    expect(strokes).toHaveLength(2);
    expect(fills).toHaveLength(2);
    expect(fills[0]!.state.textAlign).toBe("center");
    expect(fills[0]!.state.textBaseline).toBe("middle");
    const expectedStep = sym.size * 10 * 1.35;
    expect(fills[1]!.args[2] as number).toBeCloseTo(expectedStep, 4);
  });

  it("#6: TSymElt.stFlags ger rundade ändar/fogar på linjeelement i punktsymboler", () => {
    const lineEl = elementWithFlags(ELEMENT_TYPE.line, 1, 1, 25, 1, [ocdCoord(-50, 0), ocdCoord(50, 0)]);
    const body = concat(symbolBody(4, { 796: lineEl.length / 8 }), lineEl);
    const map = readMapFile(buildOcd({
      strings: COLORS,
      symbols: [{ number: 202002, type: SYMBOL_TYPE.point, body }],
      objects: [{ symbol: 202002, type: OBJECT_TYPE.point, coords: [ocdCoord(100, 100)] }]
    }));
    const sym = map.symbols.get("202002") as PointSymbol;
    expect(sym.elements[0]).toMatchObject({ kind: "line", cap: "round", join: "round" });

    const { ctx, calls } = fakeContext(100, 100);
    drawMap(ctx, map, { pxPerMm: 10, origin: { x: 0, y: 2 } });
    const strokeCall = calls.find(call => call.op === "stroke");
    expect(strokeCall?.state.lineCap).toBe("round");
    expect(strokeCall?.state.lineJoin).toBe("round");
  });

  it("#7: ytsymbolens BorderSym behåller kantlinjens punktsymboler vid ritning och färganvändning", () => {
    const tick = element(ELEMENT_TYPE.line, 2, 14, 0, [ocdCoord(0, 0), ocdCoord(0, -40)]);
    const lineBody = concat(
      symbolBody(LINE.elements - 796, {
        [LINE.color]: 1,
        [LINE.width]: 18,
        [LINE.mainLength]: 200,
        [LINE.endLength]: 100,
        [LINE.symbolCount]: 1,
        [LINE.primaryDataSize]: tick.length / 8
      }),
      tick
    );
    const areaBody = symbolBody(AREA.elements - 796, { [AREA.fillColor]: 1 }, view => {
      view.setInt32(AREA.borderSymbol - 796, 516000, true);
      view.setUint8(AREA.fillOn - 796, 1);
      view.setUint8(AREA.borderOn - 796, 1);
    });
    const map = readMapFile(buildOcd({
      strings: COLORS,
      symbols: [
        { number: 516000, type: SYMBOL_TYPE.line, body: lineBody },
        { number: 520000, type: SYMBOL_TYPE.area, body: areaBody }
      ],
      objects: [{
        symbol: 520000, type: OBJECT_TYPE.area,
        coords: [ocdCoord(0, 0), ocdCoord(600, 0), ocdCoord(600, 600), ocdCoord(0, 600)]
      }]
    }));
    const area = map.symbols.get("520000") as AreaSymbol;
    expect(area.borderDecorations?.repeated?.elements).toHaveLength(1);
    expect(colorUsage(map).get(2)?.kinds).toContain("LINE");

    const { ctx, calls } = fakeContext(100, 100);
    drawMap(ctx, map, { pxPerMm: 10, origin: { x: 0, y: 6 } });
    // Kantlinjens taggar ritas i färg 2 (vit).
    const whiteStrokes = calls.filter(call => call.op === "stroke" && call.state.strokeStyle === "rgba(255, 255, 255, 1)");
    expect(whiteStrokes.length).toBeGreaterThan(0);
  });

  it("#8: linje med mainGap = 0 och secondaryGap > 0 centrerar upprepad symbol i sekundärmellanrummet", () => {
    const dot = element(ELEMENT_TYPE.dot, 1, 0, 45, [ocdCoord(0, 0)]);
    const body = concat(
      symbolBody(LINE.elements - 796, {
        [LINE.color]: 1,
        [LINE.width]: 18,
        [LINE.mainLength]: 200,
        [LINE.endLength]: 60,
        [LINE.mainGap]: 0,
        [LINE.secondaryGap]: 35,
        [LINE.symbolCount]: 1,
        [LINE.primaryDataSize]: dot.length / 8
      }),
      dot
    );
    const map = readMapFile(buildOcd({
      strings: COLORS,
      symbols: [{ number: 106000, type: SYMBOL_TYPE.line, body }],
      objects: [{
        symbol: 106000, type: OBJECT_TYPE.line,
        coords: [ocdCoord(0, 0, 0, COORD_FLAG.corner), ocdCoord(1000, 0)]
      }]
    }));
    const sym = map.symbols.get("106000") as LineSymbol;
    expect(sym.repeated?.endLength).toBeCloseTo(0.775, 4);
  });
});

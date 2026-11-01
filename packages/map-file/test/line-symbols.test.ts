import { describe, expect, it } from "vitest";
import { GAP, readMapFile, type LineSymbol, type MapSymbol } from "../src";
import { buildOcd, concat, element, ocdCoord, symbolBody } from "./ocd-builder";

/** Tvärstreck 0,62 mm (stolpe) och ett kort streck snett bakåt (brons vinge), i 0,01 mm. */
const post = element(1, 2, 14, 0, [ocdCoord(0, -31), ocdCoord(0, 31)]);
const wing = element(1, 2, 18, 0, [ocdCoord(0, 0), ocdCoord(-15, 25)]);
const tick = element(1, 2, 14, 0, [ocdCoord(0, 0), ocdCoord(0, -45)]);

/** Linjesymbolens kropp (från 796) med fält och punktsymbolernas element efter varandra från 872. */
function lineBody(fields: Readonly<Record<number, number>>, flags: number, parts: { primary?: Uint8Array; secondary?: Uint8Array; corner?: Uint8Array; start?: Uint8Array; end?: Uint8Array }) {
  const sizes = { 860: (parts.primary?.length ?? 0) / 8, 862: (parts.secondary?.length ?? 0) / 8, 864: (parts.corner?.length ?? 0) / 8,
    866: (parts.start?.length ?? 0) / 8, 868: (parts.end?.length ?? 0) / 8 };
  const head = symbolBody(872 - 796, { 796: 2, ...fields, ...sizes }, view => view.setUint8(870 - 796, flags));
  return concat(head, ...[parts.primary, parts.secondary, parts.corner, parts.start, parts.end].filter((part): part is Uint8Array => !!part));
}

const STRINGS = [{ type: 9, value: "Svart\tn2\tc0\tm0\ty0\tk100" }];

function ocdSymbol(number: number, body: Uint8Array): LineSymbol {
  const map = readMapFile(buildOcd({ strings: STRINGS, symbols: [{ number, type: 2, body }] }), "test.ocd");
  const symbol = map.symbols.get(String(number));
  expect(symbol?.kind).toBe("LINE");
  return symbol as LineSymbol;
}

describe("OCAD-linjesymbolernas punktsymboler", () => {
  it("läser kraftledningens stolpar som hörnsymbol (510)", () => {
    const symbol = ocdSymbol(510000, lineBody({ 798: 14 }, 4, { corner: post }));
    expect(symbol.strokes).toMatchObject([{ color: 2, width: 0.14 }]);
    expect(symbol.corner).toEqual({
      stretch: true,
      elements: [{ kind: "line", color: 2, width: 0.14, path: [{ type: "M", x: 0, y: -0.31 }, { type: "L", x: 0, y: 0.31 }] }]
    });
    expect(symbol.repeated).toBeUndefined();
    expect(symbol.start).toBeUndefined();
  });

  it("använder hörn-, start-, slut- och sekundärsymbolen bara när flaggan är satt", () => {
    expect(ocdSymbol(510000, lineBody({ 798: 14 }, 0, { corner: post })).corner).toBeUndefined();
    const bridge = ocdSymbol(512000, lineBody({ 798: 18 }, 3, { start: wing, end: wing }));
    expect(bridge.start?.elements).toHaveLength(1);
    expect(bridge.end?.elements).toHaveLength(1);
    expect(ocdSymbol(512000, lineBody({ 798: 18 }, 2, { start: wing, end: wing })).end).toBeUndefined();
  });

  it("läser primärsymbolen med slutlängd, antal per ställe och avstånd (518 opasserbart staket)", () => {
    const fence = ocdSymbol(518000, lineBody({ 798: 25, 806: 250, 808: 125, 818: 2, 820: 60 }, 0, { primary: tick }));
    expect(fence.repeated).toMatchObject({ spacing: 2.5, endLength: 1.25, count: 2, groupSpacing: 0.6, minimum: 1 });
    expect(fence.repeated!.elements).toHaveLength(1);
    // Inga symboler per ställe = ingen primärsymbol, som i OCAD.
    expect(ocdSymbol(518001, lineBody({ 798: 25, 806: 250, 808: 125, 818: 0 }, 0, { primary: tick })).repeated).toBeUndefined();
  });

  it("lägger primärsymbolen i mellanrummen på en streckad linje och läser sekundärsymbolen", () => {
    const symbol = ocdSymbol(999000, lineBody({ 798: 20, 806: 200, 808: 100, 810: 50, 816: 2, 818: 1 }, 8, { primary: tick, secondary: post }));
    expect(symbol.repeated).toMatchObject({ spacing: 2.5, endLength: 1.25, count: 1, minimum: 3 });
    expect(symbol.between).toMatchObject({ spacing: 2.5, endLength: 1.25, minimum: 3 });
    expect(symbol.between!.elements).toHaveLength(1);
  });

  it("varnar men läser vidare när elementen går utanför symbolen", () => {
    const body = lineBody({ 798: 14 }, 4, { corner: post });
    const view = new DataView(body.buffer);
    view.setUint16(864 - 796, 40, true);
    const map = readMapFile(buildOcd({ strings: STRINGS, symbols: [{ number: 510000, type: 2, body }] }), "test.ocd");
    expect((map.symbols.get("510000") as LineSymbol).corner).toBeUndefined();
    expect(map.warnings.some(w => w.code === "BROKEN_SYMBOL")).toBe(true);
  });
});

describe("OCAD-koordinaternas flaggor", () => {
  const body = lineBody({ 798: 14 }, 4, { corner: post });

  it("ger hörnpunkter, streckpunkter och luckor i linjen", () => {
    const map = readMapFile(buildOcd({ strings: STRINGS, symbols: [{ number: 510000, type: 2, body }], objects: [{
      symbol: 510000, type: 2, coords: [
        ocdCoord(0, 0), ocdCoord(1000, 0, 0, 1), ocdCoord(2000, 0, 8, 8), ocdCoord(3000, 0, 4, 4), ocdCoord(4000, 0)
      ]
    }] }), "test.ocd");
    expect(map.objects[0]).toEqual({ kind: "line", symbol: "510000", path: [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 0, corner: true },
      { type: "L", x: 20, y: 0, dash: true },
      // x 8 på punkten före: ingen huvudlinje fram hit. x 4 och y 4: ingen vänster eller höger kantlinje.
      { type: "L", x: 30, y: 0, gap: GAP.main },
      { type: "L", x: 40, y: 0, gap: GAP.left | GAP.right }
    ] });
  });

  it("lägger luckan på ytans stängande sträcka på ringens första punkt", () => {
    const area = { number: 401000, type: 3, body: symbolBody(40, { 800: 2 }, view => view.setUint8(814 - 796, 1)) };
    const map = readMapFile(buildOcd({ strings: STRINGS, symbols: [area], objects: [{
      symbol: 401000, type: 3, coords: [ocdCoord(0, 0), ocdCoord(1000, 0), ocdCoord(1000, 1000, 8)]
    }] }), "test.ocd");
    const object = map.objects[0]!;
    expect(object.kind === "area" && object.rings[0]![0]).toEqual({ type: "M", x: 0, y: 0, gap: GAP.main });
  });

  it("tar inte med flaggor i punktsymbolernas element", () => {
    const symbol = ocdSymbol(510000, lineBody({ 798: 14 }, 4, { corner: element(1, 2, 14, 0, [ocdCoord(0, -31, 0, 1), ocdCoord(0, 31, 8)]) }));
    expect(symbol.corner!.elements[0]).toMatchObject({ path: [{ type: "M", x: 0, y: -0.31 }, { type: "L", x: 0, y: 0.31 }] });
    expect(JSON.stringify(symbol.corner!.elements)).not.toMatch(/corner|gap/);
  });
});

const OMAP = `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="10000"/>
<colors count="1"><color priority="0" name="Svart" c="0" m="0" y="0" k="1" opacity="1"><cmyk method="custom"/><rgb method="cmyk" r="0" g="0" b="0"/></color></colors>
<barrier version="6" required="0.6.0">
<symbols count="4" id="test">
<symbol type="2" id="0" code="510.0" name="Kraftledning"><line_symbol color="0" line_width="140" segment_length="0" end_length="0"><dash_symbol><symbol type="1" code="" name="Strecksymbol"><point_symbol rotatable="true" inner_radius="1000" inner_color="-1" outer_width="0" outer_color="-1" elements="1"><element><symbol type="2" code=""><line_symbol color="0" line_width="140"/></symbol><object type="1"><coords count="2">0 370;0 -370;</coords></object></element></point_symbol></symbol></dash_symbol></line_symbol></symbol>
<symbol type="2" id="1" code="512.0" name="Bro"><line_symbol color="0" line_width="180" suppress_dash_symbol_at_ends="true" scale_dash_symbol="false"><start_symbol><symbol type="1"><point_symbol inner_radius="200" inner_color="0" elements="0"/></symbol></start_symbol><end_symbol><symbol type="1"><point_symbol inner_radius="300" inner_color="0" elements="0"/></symbol></end_symbol><dash_symbol><symbol type="1"><point_symbol inner_radius="100" inner_color="0" elements="0"/></symbol></dash_symbol></line_symbol></symbol>
<symbol type="2" id="2" code="515.0" name="Opasserbar mur"><line_symbol color="0" line_width="250" segment_length="3000" end_length="1500" show_at_least_one_symbol="true" mid_symbols_per_spot="2" mid_symbol_distance="800" mid_symbol_placement="2"><mid_symbol><symbol type="1"><point_symbol inner_radius="300" inner_color="0" elements="0"/></symbol></mid_symbol></line_symbol></symbol>
<symbol type="2" id="3" code="999.0" name="Streckad med prickar"><line_symbol color="0" line_width="140" dashed="true" dash_length="1650" break_length="350" segment_length="4000" mid_symbol_placement="2"><mid_symbol><symbol type="1"><point_symbol inner_radius="200" inner_color="0" elements="0"/></symbol></mid_symbol></line_symbol></symbol>
</symbols>
<parts count="1" current="0"><part name="del"><objects count="1">
<object type="1" symbol="0"><coords count="4">0 0;10000 0 32;20000 -5000;30000 -5000 32;</coords></object>
</objects></part></parts>
</barrier>
</map>
`;

describe("Mappers linjesymboler", () => {
  const map = readMapFile(new TextEncoder().encode(OMAP), "test.omap");
  const line = (id: string): LineSymbol => map.symbols.get(id) as MapSymbol as LineSymbol;

  it("läser strecksymbolen som hörnsymbol och streckpunkterna som hörn", () => {
    expect(line("0").corner).toMatchObject({ stretch: true, skipEnds: false, elements: [{ kind: "line", color: 0, width: 0.14 }] });
    expect(line("1").corner).toMatchObject({ stretch: false, skipEnds: true });
    const object = map.objects[0]!;
    expect(object.kind === "line" && object.path.map(command => command.corner ?? false)).toEqual([false, true, false, true]);
  });

  it("läser start- och slutsymbolen", () => {
    expect(line("1").start?.elements).toMatchObject([{ kind: "dot", diameter: 0.4 }]);
    expect(line("1").end?.elements).toMatchObject([{ kind: "dot", diameter: 0.6 }]);
  });

  it("läser mittsymbolerna med slutlängd och flera per ställe", () => {
    // Två prickar 0,8 mm isär per ställe: avståndet räknas mellan grupperna, slutlängden till gruppens mitt.
    expect(line("2").repeated).toMatchObject({ spacing: 3.8, endLength: 1.9, count: 2, groupSpacing: 0.8, minimum: 1 });
    // Streckad linje med symbolen i mellanrummen: först efter ett helt streck och ett halvt mellanrum.
    const dashed = line("3").repeated!;
    expect(dashed).toMatchObject({ count: 1, minimum: 1 });
    expect(dashed.spacing).toBeCloseTo(2, 9);
    expect(dashed.endLength).toBeCloseTo(1.65 + 0.35 / 2, 9);
  });
});

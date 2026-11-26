import { describe, expect, it } from "vitest";
import { readMapFile, SYMBOL_SETS } from "../src";
import { Bytes } from "../src/ocd/bytes";
import { HEADER } from "../src/ocd/layout";
import {
  applyOcdNormSymbols, applyOcdSymbolColorChanges, applyOcdTextSymbolChanges, ICON_BG, iconBitsOffset,
  packOcdDocument, parseOcdDocument, SYMBOL_HEAD, verifyOcdDocument
} from "../src/ocd/writer";
import { buildOcd, ocdCoord, symbolBody } from "./ocd-builder";
import { SPEC } from "./ocd-spec";

const SPRINT = SYMBOL_SETS["ISSPROM2019-2"];
const sprintDef = (code: string) => SPRINT.symbols.find(s => s.code === code)!;

describe("OcdDocument — symbolfärger, textsymboler och normsymboler (v9–2018)", () => {
  for (const version of [2018, 11, 9]) {
    it(`byter symbolfärger för punkt, linje, yta (inkl. delad BorderSym), text och rektangel (OCAD ${version})`, () => {
      // Yta 521.0 pekar på kantsymbol 521.1 som OCKSÅ används av ett fristående linjeobjekt (delad BorderSym!).
      const borderLine = { number: 521001, type: 2, body: symbolBody(80, { 796: 2, 798: 15, 800: 4 }) };
      const building = {
        number: 521000, type: 3,
        body: symbolBody(40, { 800: 34 }, view => {
          view.setInt32(0, 521001, true); // AREA.borderSymbol = 521001
          view.setUint8(814 - 796, 1);    // fillOn
          view.setUint8(815 - 796, 1);    // borderOn
        })
      };
      const rect = { number: 800000, type: 7, body: symbolBody(16, { 796: 2, 798: 20 }) };
      const src = buildOcd({
        ...SPEC,
        version,
        symbols: [...SPEC.symbols!, borderLine, building, rect],
        objects: [
          ...SPEC.objects!,
          { symbol: 521001, type: 2, coords: [ocdCoord(0, 0), ocdCoord(200, 0)] },
          { symbol: 800000, type: 7, coords: [ocdCoord(0, 0), ocdCoord(100, 0), ocdCoord(100, 100), ocdCoord(0, 100)] }
        ]
      });

      const res = applyOcdSymbolColorChanges(src, [
        { symbol: "101.0", from: 2, to: 54 },
        { symbol: "105.100", from: 2, to: 54 },
        { symbol: "521.0", from: 34, to: 54 },
        { symbol: "521.0", from: 2, to: 54 }, // kantfärgen på 521.0 ska bytas utan att sabba fristående 521.1!
        { symbol: "902.0", from: 2, to: 54 },
        { symbol: "800.0", from: 2, to: 54 }
      ]);
      if (!res.ok) throw new Error(res.message);
      expect(res.changed).toBe(5);

      const after = readMapFile(res.bytes, "symcol.ocd");
      const s101 = after.symbols.get("101000")!;
      const s105 = after.symbols.get("105100")!;
      const s521 = after.symbols.get("521000")!;
      const s521Edge = after.symbols.get("521001")!;
      const s902 = after.symbols.get("902000")!;
      const s800 = after.symbols.get("800000")!;

      expect(s101.kind === "LINE" && s101.strokes[0]?.color).toBe(54);
      expect(s105.kind === "POINT" && s105.elements[0]?.color).toBe(54);
      expect(s521.kind === "AREA" && s521.fill).toBe(54);
      expect(s521.kind === "AREA" && s521.border?.[0]?.color).toBe(54);
      // Delad kantsymbol 521.1 förblev svart (2) eftersom den klonades till en dold hjälpsymbol!
      expect(s521Edge.kind === "LINE" && s521Edge.strokes[0]?.color).toBe(2);
      expect(s902.kind === "TEXT" && s902.color).toBe(54);
      expect(s800.kind === "LINE" && s800.strokes[0]?.color).toBe(54);
    });
  }

  it("uppdaterar befintlig textsymbol (inkl. framing och justering) och skapar kopierad textsymbol", () => {
    const src = buildOcd({ ...SPEC, version: 2018 });
    const res = applyOcdTextSymbolChanges(src, [
      {
        id: "902000",
        fontFamily: "Helvetica",
        size: 3.5,
        color: 54,
        bold: false,
        italic: true,
        align: "center",
        framing: { color: 34, width: 0.4 }
      },
      {
        id: "999999",
        copyOf: "902000",
        code: "902.1",
        name: "Stor rubrik",
        fontFamily: "Arial",
        size: 6,
        color: 2,
        bold: true,
        italic: false,
        align: "right",
        framing: null
      }
    ]);
    if (!res.ok) throw new Error(res.message);
    expect(res.changed).toBe(2);
    // In-memory id "999999" mappades till riktigt OCAD-nummer "902001" (902.1)!
    expect(res.symbolIdMap?.get("999999")).toBe("902001");

    const after = readMapFile(res.bytes, "text.ocd");
    const edited = after.symbols.get("902000")!;
    expect(edited.kind).toBe("TEXT");
    if (edited.kind === "TEXT") {
      expect(edited.fontFamily).toBe("Helvetica");
      expect(edited.size).toBeCloseTo(3.5, 1);
      expect(edited.color).toBe(54);
      expect(edited.bold).toBe(false);
      expect(edited.italic).toBe(true);
      expect(edited.align).toBe("center");
      expect(edited.framing).toEqual({ color: 34, width: 0.4 });
    }

    const copied = after.symbols.get("902001")!;
    expect(copied.kind).toBe("TEXT");
    if (copied.kind === "TEXT") {
      expect(copied.code.text).toBe("902.1");
      expect(copied.name).toBe("Stor rubrik");
      expect(copied.size).toBeCloseTo(6, 1);
      expect(copied.bold).toBe(true);
      expect(copied.align).toBe("right");
      expect(copied.framing).toBeUndefined();
    }
  });

  it("serialiserar normsymboler (punkt, dubbellinje+steg 532, kantad yta 521, prickmönster 113, text) med Colors[0..13] och 22×22 IconBits", () => {
    const src = buildOcd({
      ...SPEC,
      version: 2018,
      symbols: [
        ...SPEC.symbols!,
        // En gammal felaktig byggnad (521.0) som ska bytas ut mot sprintnormens 521 (grå 50% + svart kant)!
        { number: 521000, type: 3, description: "Gammalt hus", status: 2, body: symbolBody(40, { 800: 2 }, v => v.setUint8(814 - 796, 1)) }
      ]
    });
    const doc = parseOcdDocument(src);
    const stats = applyOcdNormSymbols(
      doc,
      [{ code: "521.0", def: sprintDef("521"), palette: SPRINT.colors }],
      [
        { code: "532", def: sprintDef("532"), palette: SPRINT.colors, add: true },
        { code: "113", def: sprintDef("113"), palette: SPRINT.colors, add: true },
        { code: "545", def: sprintDef("545"), palette: SPRINT.colors, add: true }
      ]
    );
    expect(stats.changed).toBe(4);
    expect(stats.symbolIdMap.size).toBe(3);

    const packed = packOcdDocument(doc);
    const verified = verifyOcdDocument(packed.bytes);
    if (!verified.ok) throw new Error(verified.message);
    const after = verified.map;

    // 521.0 byttes ut mot grå 50% fyllning + svart kantlinje, med bevarat namn & hidden=true!
    const s521 = after.symbols.get("521000")!;
    expect(s521.kind).toBe("AREA");
    expect(s521.name).toBe("Gammalt hus");
    expect(s521.hidden).toBe(true);
    if (s521.kind === "AREA") {
      expect(s521.fill).toBeDefined();
      const fillCol = after.colors.find(c => c.id === s521.fill)!;
      expect(fillCol.cmyk.k).toBeCloseTo(0.5, 2);
      expect(s521.border?.[0]?.color).toBe(2);
    }

    // 532.0 Trappa: brunt band + svarta kanter + upprepade steg!
    const s532 = after.symbols.get("532000")!;
    expect(s532.kind).toBe("LINE");
    if (s532.kind === "LINE") {
      expect(s532.strokes.some(s => !s.offset && s.width > 0)).toBe(true);
      expect(s532.strokes.some(s => (s.offset ?? 0) > 0)).toBe(true);
      expect(s532.strokes.some(s => (s.offset ?? 0) < 0)).toBe(true);
      expect(s532.repeated?.elements.length).toBeGreaterThan(0);
    }

    // 113.0 Gropig mark: förskjutet prickmönster (staggered -> 2 element i dubbla rutan vid läsning).
    const s113 = after.symbols.get("113000")!;
    expect(s113.kind).toBe("AREA");
    if (s113.kind === "AREA") {
      expect(s113.pattern?.elements.length).toBe(2);
    }

    // 545.0 punktsymbol: har ritade element och giltig 22×22 IconBits + Colors[0..13]!
    const s545 = after.symbols.get("545000")!;
    expect(s545.kind).toBe("POINT");
    if (s545.kind === "POINT") expect(s545.elements.length).toBeGreaterThan(0);

    // Kontrollera binärt Colors[0..13] och 22×22 IconBits för nya symboler (ej tom vit ruta!).
    const bytes = new Bytes(packed.bytes);
    const symBlock = bytes.u32(HEADER.firstSymbolBlock);
    const iconOff = iconBitsOffset(doc.variant);
    let checked545 = false;
    for (let slot = 0; slot < 256; slot++) {
      const pos = bytes.i32(symBlock + 4 + slot * 4);
      if (pos <= 0 || bytes.i32(pos + 4) !== 545000) continue;
      checked545 = true;
      expect(bytes.i16(pos + SYMBOL_HEAD.nColors)).toBeGreaterThan(0);
      expect(bytes.i32(pos + SYMBOL_HEAD.extent)).toBeGreaterThan(0);
      const iconSlice = packed.bytes.subarray(pos + iconOff, pos + iconOff + 22 * 22);
      expect(iconSlice.some(px => px !== ICON_BG)).toBe(true);
    }
    expect(checked545).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  applyMapRevision, convertMapToOcd, convertMapToOmap, GAP, mapPointToProjected, newMapFile, newOcdFile, NewMapError,
  readMapFile, sha256Hex, SYMBOL_SETS, wgs84ToProjected, type AreaSymbol, type LineSymbol, type MapObject, type ParsedMap
} from "../src";
import { Bytes } from "../src/ocd/bytes";
import { HEADER } from "../src/ocd/layout";
import {
  applyOcdColors, createEmptyOcdV12Document, decodeOcdString, DISPLAY_STRING_TYPE, documentColors, encodeOcdSymbol, ICON_BG,
  iconBitsOffset, packOcdDocument, parseOcdDocument, STRING_TYPE, SYMBOL_HEAD, symbolDefToMapSymbol, verifyOcdDocument
} from "../src/ocd/writer";
import { dot, stroke, type SymbolDef } from "../src/template/symbol-def";
import { gridConvergenceDegrees } from "../src/template/new-map";
import { buildOcd, ocdCoord } from "./ocd-builder";
import { SPEC } from "./ocd-spec";

const KUNGSHATT = wgs84ToProjected({ kind: "EPSG", code: 3006 }, 59.307, 17.79);
const META = { author: "konto-1", at: "2026-11-26T18:00:00Z" } as const;

describe("Etapp 5B: newOcdFile() — nya OCAD 12-kartor från grunden", () => {
  for (const id of ["ISOM2017-2", "ISSPROM2019-2"] as const) {
    for (const { scale } of SYMBOL_SETS[id].scales) {
      it(`${id} 1:${scale}: skriver komplett OCAD 12-fil som läses tillbaka utan varningar`, () => {
        const set = SYMBOL_SETS[id];
        const bytes = newOcdFile({ symbolSet: id, scale, refPoint: KUNGSHATT, declinationDegrees: 6.5 });

        // 60-byte TFileHeader: OCD_MARK, fileType=0, version=12, subversion=0.
        const raw = new Bytes(bytes);
        expect(raw.u16(HEADER.mark)).toBe(0x0cad);
        expect(raw.u16(HEADER.fileType)).toBe(0);
        expect(raw.u16(HEADER.version)).toBe(12);
        expect(raw.u8(HEADER.subversion)).toBe(0);
        expect(raw.i32(HEADER.offlineSyncSerial)).toBe(0);

        const verified = verifyOcdDocument(bytes, { exactObjects: 0 });
        if (!verified.ok) throw new Error(verified.message);
        const map = verified.map;

        expect(map.format).toBe("OCD");
        expect(map.version).toBe("OCAD 12.0");
        expect(map.scale).toBe(scale);
        expect(map.warnings).toEqual([]);
        expect(map.objects).toEqual([]);

        // Exakt IOF-färgtabell i ordning.
        expect(map.colors).toHaveLength(set.colors.length);
        map.colors.forEach((color, idx) => {
          const want = set.colors[idx]!;
          expect(color.rank).toBe(idx);
          expect(color.name).toBe(want.name);
          expect(color.cmyk.c).toBeCloseTo(want.cmyk[0], 3);
          expect(color.cmyk.m).toBeCloseTo(want.cmyk[1], 3);
          expect(color.cmyk.y).toBeCloseTo(want.cmyk[2], 3);
          expect(color.cmyk.k).toBeCloseTo(want.cmyk[3], 3);
        });

        // Georeferens SWEREF 99 TM (e3006, i13002), referenspunkt & grivation matchar newMapFile.
        const georef = map.georeference!;
        expect(georef.crs).toEqual({ kind: "EPSG", code: 3006 });
        expect(georef.refPoint.easting).toBeCloseTo(KUNGSHATT.easting, 1);
        expect(georef.refPoint.northing).toBeCloseTo(KUNGSHATT.northing, 1);
        expect(georef.mapRefPoint).toEqual({ x: 0, y: 0 });
        const convergence = gridConvergenceDegrees(KUNGSHATT);
        expect(georef.grivationDegrees).toBeCloseTo(6.5 - convergence, 1);

        // Alla SymbolDef finns med + dolda BorderSym-linjer för kantade ytor.
        const codes = new Set([...map.symbols.values()].filter(s => !s.hidden).map(s => `${s.code.main}${s.code.sub ? `.${s.code.sub}` : ""}`));
        for (const def of set.symbols) {
          expect(codes.has(def.code), `saknar symbol ${def.code}`).toBe(true);
        }

        // Visnings-, utskrifts-, vy- och skalsträngar (1024/1026/1030/1039) finns.
        const doc = parseOcdDocument(bytes);
        const types = new Set(doc.strings.map(s => s.recType));
        expect(types.has(STRING_TYPE.scalePar)).toBe(true);
        expect(types.has(DISPLAY_STRING_TYPE.displayPar)).toBe(true);
        expect(types.has(DISPLAY_STRING_TYPE.printPar)).toBe(true);
        expect(types.has(DISPLAY_STRING_TYPE.viewPar)).toBe(true);
        const scaleStr = decodeOcdString(doc.strings.find(s => s.recType === STRING_TYPE.scalePar)!.raw);
        expect(scaleStr).toContain("\te3006");
        expect(scaleStr).toContain("\ti13002");
        expect(scaleStr).toContain("\tr1");
      });
    }
  }

  it("skapar dolda BorderSym-linjer, Colors[0..13], Extent och 22×22 IconBits för kantade ytor som ISSprOM 521 Byggnad", () => {
    const bytes = newOcdFile({ symbolSet: "ISSPROM2019-2", scale: 4000, refPoint: KUNGSHATT });
    const map = readMapFile(bytes, "ny.ocd");
    const building = [...map.symbols.values()].find(s => s.code.main === 521 && s.code.sub === 0) as AreaSymbol;
    expect(building.kind).toBe("AREA");
    expect(building.fill).toBeDefined();
    expect(building.border).toHaveLength(1);
    expect(building.border![0]!.width).toBeCloseTo(0.14, 2);

    // Kontrollera att minst en dold hjälpsymbol (521.900+) skapats och att 521 har Colors + icke-tom 22×22 IconBits.
    const doc = parseOcdDocument(bytes);
    const hiddenBorders = doc.symbols.filter(s => s.status === 2 && Math.floor(s.number / 1000) === 521);
    expect(hiddenBorders.length).toBeGreaterThanOrEqual(1);
    const raw521 = doc.symbols.find(s => s.number === 521000)!;
    const view = new DataView(raw521.bytes.buffer, raw521.bytes.byteOffset, raw521.bytes.byteLength);
    expect(view.getInt16(SYMBOL_HEAD.nColors, true)).toBeGreaterThanOrEqual(1);
    const iconOff = iconBitsOffset(doc.variant);
    const icon = raw521.bytes.subarray(iconOff, iconOff + 22 * 22);
    expect(icon.some(px => px !== ICON_BG)).toBe(true);
  });

  it("tar emot nya objekt via applyMapRevision(ocad: true) direkt på nyskapad .ocd-fil", () => {
    const bytes = newOcdFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: KUNGSHATT });
    const before = readMapFile(bytes, "ny.ocd");
    const symId = (main: number) => [...before.symbols.values()].find(s => s.code.main === main && s.code.sub === 0)!.id;
    const result = applyMapRevision(bytes, {
      baseFileSha256: sha256Hex(bytes),
      format: "OCD",
      changes: [
        { kind: "add", ...META, id: "p1", symbol: symId(204), geometry: { kind: "point", at: { x: 10, y: 20 } } },
        { kind: "add", ...META, id: "l1", symbol: symId(505), geometry: { kind: "line", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 15, y: 8 }] } },
        { kind: "add", ...META, id: "t1", symbol: symId(999), geometry: { kind: "text", at: { x: 5, y: -5 } }, text: "Kungshatt" }
      ]
    }, { ocad: true });
    if (!result.ok) throw new Error(JSON.stringify(result.refusals));
    const verified = verifyOcdDocument(result.bytes, { exactObjects: 3 });
    if (!verified.ok) throw new Error(verified.message);
    expect(verified.map.objects.map(o => o.kind)).toEqual(["point", "line", "text"]);
  });

  it("mappar alla nya SymbolDef-fält (dashGroup, halfOuterDashes, mid.count/groupSpacing, corner, start, end) till OCAD-symboler", () => {
    const doc = createEmptyOcdV12Document();
    applyOcdColors(doc, [{ kind: "add", id: 1, name: "Svart", cmyk: { c: 0, m: 0, y: 0, k: 1 } }]);
    const colors = documentColors(doc);
    const colorMap = new Map([["black", 1]]);

    const defs: SymbolDef[] = [
      {
        code: "507", name: "Otydlig stig", kind: "line", color: "black", width: 0.18,
        dash: [1.0, 1.0], dashGroup: { count: 2, breakLength: 0.25 }, halfOuterDashes: true
      },
      {
        code: "106", name: "Raserad vall", kind: "line", color: "black", width: 0.25,
        dash: [1.5, 0.25], halfOuterDashes: false
      },
      {
        code: "518", name: "Oöverstigligt staket", kind: "line", color: "black", width: 0.25,
        mid: { elements: [stroke("black", 0.14, [0, 0.4], [0, -0.4])], spacing: 2.0, count: 2, groupSpacing: 0.35 }
      },
      {
        code: "510", name: "Kraftledning", kind: "line", color: "black", width: 0.14,
        corner: { elements: [dot("black", 0.5)], stretch: true }
      },
      {
        code: "512", name: "Bro", kind: "line", color: "black", width: 0.2,
        start: [stroke("black", 0.14, [-0.4, 0.4], [0, 0])],
        end: [stroke("black", 0.14, [0, 0], [0.4, -0.4])]
      }
    ];

    for (const def of defs) {
      const num = Number(def.code) * 1000;
      const { symbol } = symbolDefToMapSymbol(def, num, 1, colorMap);
      doc.symbols.push(encodeOcdSymbol(symbol, { number: num, variant: doc.variant, colors }));
    }
    const packed = packOcdDocument(doc);
    const verified = verifyOcdDocument(packed.bytes, { exactObjects: 0 });
    if (!verified.ok) throw new Error(verified.message);

    const s507 = verified.map.symbols.get("507000") as LineSymbol;
    expect(s507.strokes[0]?.dashSpec?.mainLength).toBeCloseTo(2.25, 2);
    expect(s507.strokes[0]?.dashSpec?.secondaryGap).toBeCloseTo(0.25, 2);
    expect(s507.strokes[0]?.dashSpec?.mainGap).toBeCloseTo(1.0, 2);
    expect(s507.strokes[0]?.dashSpec?.endLength).toBeCloseTo(1.13, 2);

    const s106 = verified.map.symbols.get("106000") as LineSymbol;
    expect(s106.strokes[0]?.dashSpec?.endLength).toBeCloseTo(1.5, 2);

    const s518 = verified.map.symbols.get("518000") as LineSymbol;
    expect(s518.repeated?.count).toBe(2);
    expect(s518.repeated?.groupSpacing).toBeCloseTo(0.35, 2);

    const s510 = verified.map.symbols.get("510000") as LineSymbol;
    expect(s510.corner?.elements).toHaveLength(1);

    const s512 = verified.map.symbols.get("512000") as LineSymbol;
    expect(s512.start?.elements).toHaveLength(1);
    expect(s512.end?.elements).toHaveLength(1);
  });

  it("ärver alla Etapp 5A-mallfixar direkt i newOcdFile() (507 dubbelstreck, 510/511 hörn, 512 brovingar, 518 par, 307 kant, oliv CMYK, 1:3 000 4/3)", () => {
    const isom = readMapFile(newOcdFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: KUNGSHATT }), "isom.ocd");
    const byCode = (map: ParsedMap, main: number, sub = 0) =>
      [...map.symbols.values()].find(s => !s.hidden && s.code.main === main && s.code.sub === sub);

    expect(isom.colors.find(c => c.name === "Olivgrön")?.cmyk).toEqual({ c: 0.38, m: 0.27, y: 1, k: 0 });
    expect((byCode(isom, 307) as AreaSymbol).border?.length).toBeGreaterThan(0);
    expect((byCode(isom, 507) as LineSymbol).strokes[0]?.dashSpec?.secondaryGap).toBeGreaterThan(0);
    expect((byCode(isom, 510) as LineSymbol).corner?.elements.length).toBeGreaterThan(0);
    expect((byCode(isom, 511) as LineSymbol).corner?.elements.length).toBeGreaterThan(0);
    expect((byCode(isom, 512) as LineSymbol).start?.elements.length).toBeGreaterThan(0);
    expect((byCode(isom, 512) as LineSymbol).end?.elements.length).toBeGreaterThan(0);
    expect((byCode(isom, 518) as LineSymbol).repeated?.count).toBe(2);
    const s106 = byCode(isom, 106) as LineSymbol;
    expect(s106.strokes[0]?.dashSpec?.endLength).toBeCloseTo(s106.strokes[0]!.dashSpec!.mainLength, 2);

    const s4k = readMapFile(newOcdFile({ symbolSet: "ISSPROM2019-2", scale: 4000, refPoint: KUNGSHATT }), "s4k.ocd");
    const s3k = readMapFile(newOcdFile({ symbolSet: "ISSPROM2019-2", scale: 3000, refPoint: KUNGSHATT }), "s3k.ocd");
    const w4k = (byCode(s4k, 101) as LineSymbol).strokes[0]!.width;
    const w3k = (byCode(s3k, 101) as LineSymbol).strokes[0]!.width;
    expect(w3k).toBeCloseTo(w4k * (4 / 3), 2);
  });

  it("vägrar ogiltig skala och punkt utanför Sverige med NewMapError", () => {
    expect(() => newOcdFile({ symbolSet: "ISSPROM2019-2", scale: 10000, refPoint: KUNGSHATT })).toThrow(NewMapError);
    expect(() => newOcdFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: { easting: 0, northing: 0 } })).toThrow(NewMapError);
  });
});

describe("Etapp 5B: convertMapToOcd() och convertMapToOmap() — fullkartekonvertering med formatgapsrapport", () => {
  it("konverterar en .omap-karta (inkl. COMBINED byggnad, kurvor, hål, streckpunkter, texter och 0,001 mm) till giltig OCAD 12", () => {
    const omapBytes = newMapFile({ symbolSet: "ISSPROM2019-2", scale: 4000, refPoint: KUNGSHATT, declinationDegrees: 5.2 });
    const base = readMapFile(omapBytes, "sprint.omap");
    const symId = (main: number, sub = 0) => [...base.symbols.values()].find(s => s.code.main === main && s.code.sub === sub)!.id;

    // Lägg in alla objektslag + 0,001 mm koordinatprecision + kurva + hål + streckpunkt + COMBINED-byggnad (521).
    const objects: MapObject[] = [
      { kind: "point", symbol: symId(204), at: { x: 12.345, y: -6.789 }, angle: 45 },
      {
        kind: "line",
        symbol: symId(505),
        path: [
          { type: "M", x: 0, y: 0, corner: true },
          { type: "C", x1: 5, y1: 10, x2: 15, y2: 10, x: 20, y: 0 },
          { type: "L", x: 30, y: 5, dash: true }
        ]
      },
      {
        kind: "area",
        symbol: symId(521), // COMBINED: grå yta + svart kantlinje -> ska bli OCAD TAreaSym + BorderSym!
        rings: [
          [{ type: "M", x: 0, y: 0 }, { type: "L", x: 20, y: 0 }, { type: "L", x: 20, y: 20 }, { type: "L", x: 0, y: 20 }],
          [{ type: "M", x: 5, y: 5 }, { type: "L", x: 15, y: 5 }, { type: "L", x: 15, y: 15 }, { type: "L", x: 5, y: 15 }]
        ],
        angle: 15
      },
      { kind: "text", symbol: symId(999), at: { x: 40, y: 10 }, angle: 30, text: "Målområde\nRad 2" }
    ];
    const synthetic: ParsedMap = { ...base, objects };

    const { bytes, report } = convertMapToOcd(synthetic, { sourcePartCount: 2, at: META.at });
    expect(report.sourceFormat).toBe("OMAP");
    expect(report.targetFormat).toBe("OCD");
    expect(report.objects).toBe(4);
    expect(report.skippedObjects).toBe(0);
    expect(report.warnings.some(w => w.code === "PRECISION_ROUNDED")).toBe(true);
    expect(report.warnings.some(w => w.code === "MULTIPLE_PARTS_MERGED")).toBe(true);

    const verified = verifyOcdDocument(bytes, { exactObjects: 4 });
    if (!verified.ok) throw new Error(verified.message);
    const reread = verified.map;
    expect(reread.warnings).toEqual([]);
    expect(reread.colors).toHaveLength(base.colors.length);
    expect(reread.georeference?.crs).toEqual({ kind: "EPSG", code: 3006 });
    expect(reread.georeference?.grivationDegrees).toBeCloseTo(base.georeference!.grivationDegrees, 2);

    // Byggnaden (521) blev en native OCAD AREA med BorderSym (svart kant) och bevarat hål!
    const areaObj = reread.objects.find(o => o.kind === "area")!;
    expect(areaObj.kind === "area" && areaObj.rings).toHaveLength(2);
    const buildingSym = reread.symbols.get(areaObj.symbol) as AreaSymbol;
    expect(buildingSym.kind).toBe("AREA");
    expect(buildingSym.fill).toBeDefined();
    expect(buildingSym.border).toHaveLength(1);

    // Kurva & styrpunkt bevarades.
    const lineObj = reread.objects.find(o => o.kind === "line")!;
    expect(lineObj.kind === "line" && lineObj.path.some(c => c.type === "C")).toBe(true);
    expect(lineObj.kind === "line" && lineObj.path.some(c => c.dash)).toBe(true);

    // Text bevarades med radbrytning.
    const textObj = reread.objects.find(o => o.kind === "text")!;
    expect(textObj.kind === "text" && textObj.text).toBe("Målområde\nRad 2");
  });

  it("hanterar icke-noll mapRefPoint (exakt geografiskt läge) och komplex COMBINED-symbol med 3 delar i convertMapToOcd", () => {
    const map: ParsedMap = {
      format: "OMAP",
      version: "Mapper v9",
      scale: 10000,
      colors: [
        { id: 0, name: "Svart", rank: 0, cmyk: { c: 0, m: 0, y: 0, k: 1 }, rgb: { r: 0, g: 0, b: 0 }, opacity: 1, overprint: true },
        { id: 1, name: "Brun", rank: 1, cmyk: { c: 0, m: 0.56, y: 1, k: 0.18 }, rgb: { r: 0.7, g: 0.3, b: 0 }, opacity: 1 }
      ],
      symbols: new Map([
        ["1", { id: "1", code: { text: "502.1", main: 502, sub: 1 }, name: "Del 1", hidden: false, kind: "LINE", strokes: [{ color: 0, width: 0.2 }] }],
        ["2", { id: "2", code: { text: "502.2", main: 502, sub: 2 }, name: "Del 2", hidden: false, kind: "LINE", strokes: [{ color: 1, width: 0.4 }] }],
        ["3", { id: "3", code: { text: "502", main: 502, sub: 0 }, name: "Kombi väg", hidden: false, kind: "COMBINED", parts: ["1", "2"] }]
      ]),
      objects: [
        { kind: "line", symbol: "3", path: [{ type: "M", x: 100, y: 50 }, { type: "L", x: 120, y: 60 }] }
      ],
      georeference: {
        scale: 10000,
        crs: { kind: "EPSG", code: 3006 },
        refPoint: { easting: 675000, northing: 6580000 },
        mapRefPoint: { x: 100, y: 50 },
        grivationDegrees: 2.5,
        combinedScaleFactor: 1.0005
      },
      bounds: { minX: 100, minY: 50, maxX: 120, maxY: 60 },
      warnings: []
    };

    const { bytes, report } = convertMapToOcd(map);
    expect(report.objects).toBe(2); // Delad i 2 linjeobjekt (ett per delsymbol)
    expect(report.warnings.map(w => w.code)).toEqual(expect.arrayContaining(["MAP_REF_SHIFTED", "AUXILIARY_SCALE_FACTOR", "COMBINED_SPLIT"]));

    const after = readMapFile(bytes, "kombi.ocd");
    expect(after.objects).toHaveLength(2);
    const firstPt = after.objects[0]!.kind === "line" ? after.objects[0]!.path[0]! : { x: 999, y: 999 };
    expect(firstPt.x).toBeCloseTo(0, 2);
    expect(firstPt.y).toBeCloseTo(0, 2);
    // Geografiskt läge vid referenspunkten bevarat!
    const projected = mapPointToProjected(after.georeference!, firstPt);
    expect(projected.easting).toBeCloseTo(675000, 1);
    expect(projected.northing).toBeCloseTo(6580000, 1);
  });

  it("konverterar en .ocd-karta (inkl. spotfärg, gap, oregelbundet mönster, dubbelstreck, kurvor och text) till giltig .omap", () => {
    const srcOcd = buildOcd({
      ...SPEC,
      version: 2018,
      objects: [
        ...SPEC.objects!,
        { symbol: 101000, type: 2, coords: [ocdCoord(0, 0, 8, 0), ocdCoord(1000, 0), ocdCoord(1000, 500)] } // med mainGap!
      ]
    });
    const parsedOcd = readMapFile(srcOcd, "test.ocd");
    // Lägg på dekorfärg, oregelbundet mönster och sekundärsymbol för att testa alla formatgap.
    const enrichedColors = parsedOcd.colors.map((c, idx) =>
      idx === 0
        ? { ...c, overprint: true, spot: { name: "Process Black", overprint: true, separations: [{ name: "Process Black", factor: 1, cmyk: c.cmyk }] } }
        : c
    );
    const enrichedSymbols = new Map(parsedOcd.symbols);
    const lineSym = [...enrichedSymbols.values()].find((s): s is LineSymbol => s.kind === "LINE")!;
    enrichedSymbols.set(lineSym.id, {
      ...lineSym,
      between: { elements: [{ kind: "dot", color: 2, center: { x: 0, y: 0 }, diameter: 0.3 }], spacing: 2 }
    });
    const areaSym = [...enrichedSymbols.values()].find((s): s is AreaSymbol => s.kind === "AREA")!;
    enrichedSymbols.set(areaSym.id, {
      ...areaSym,
      pattern: {
        elements: [{ kind: "dot", color: 2, center: { x: 0, y: 0 }, diameter: 0.2 }],
        dx: 1.5, dy: 1.5, angle: 0,
        irregular: { jitterX: 0.2, jitterY: 0.2, minDist: 0.3 }
      }
    });
    const enrichedMap: ParsedMap = {
      ...parsedOcd,
      colors: enrichedColors,
      symbols: enrichedSymbols,
      objects: parsedOcd.objects.map(o =>
        o.kind === "line" && o.path.some(c => c.gap)
          ? o
          : o.kind === "line"
          ? { ...o, path: o.path.map((c, i) => (i === 1 ? { ...c, gap: GAP.main } : c)) }
          : o
      )
    };

    const { bytes, report } = convertMapToOmap(enrichedMap);
    expect(report.sourceFormat).toBe("OCD");
    expect(report.targetFormat).toBe("OMAP");
    expect(report.objects).toBe(enrichedMap.objects.length);
    expect(report.skippedObjects).toBe(0);
    expect(report.warnings.map(w => w.code)).toEqual(
      expect.arrayContaining(["OCAD_GAPS_DROPPED", "IRREGULAR_PATTERN_REGULARIZED", "SECONDARY_SYMBOL_DROPPED"])
    );

    const reread = readMapFile(bytes, "konverterad.omap");
    expect(reread.format).toBe("OMAP");
    expect(reread.warnings).toEqual([]);
    expect(reread.colors).toHaveLength(enrichedMap.colors.length);
    expect(reread.colors[0]!.spot?.name).toBe("Process Black");
    expect(reread.colors[0]!.spot?.overprint).toBe(true);
    expect(reread.objects).toHaveLength(enrichedMap.objects.length);
    expect(reread.georeference?.crs).toEqual(enrichedMap.georeference?.crs);
    expect(reread.georeference?.refPoint.easting).toBeCloseTo(enrichedMap.georeference!.refPoint.easting, 1);
  });

  it("bevarar dubbellinjebredd och kantlinje-offset exakt i newOcdFile och encodeOcdSymbol (502, 511, 502.0/502.2)", () => {
    const ocdMap = readMapFile(newOcdFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: KUNGSHATT }), "ny.ocd");
    const omapMap = readMapFile(newMapFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: KUNGSHATT }), "ny.omap");

    for (const main of [502, 511] as const) {
      const sOcd = [...ocdMap.symbols.values()].find((s): s is LineSymbol => s.kind === "LINE" && s.code.main === main && s.code.sub === 0)!;
      const sOmap = [...omapMap.symbols.values()].find((s): s is LineSymbol => s.kind === "LINE" && s.code.main === main && s.code.sub === 0)!;
      expect(sOcd.strokes.map(st => ({ width: Number(st.width.toFixed(3)), offset: Number((st.offset ?? 0).toFixed(3)) }))).toEqual(
        sOmap.strokes.map(st => ({ width: Number(st.width.toFixed(3)), offset: Number((st.offset ?? 0).toFixed(3)) }))
      );
    }

    // Round-trip av OCAD 502.0 (framing 1,26 + DblFill 1,14 + vänster/höger 0,14 på ±0,64 + mittlinje 0,14).
    const doc = createEmptyOcdV12Document();
    applyOcdColors(doc, [
      { kind: "add", id: 2, name: "Svart", cmyk: { c: 0, m: 0, y: 0, k: 1 } },
      { kind: "add", id: 8, name: "Vägfyllning", cmyk: { c: 0.1, m: 0.35, y: 0.5, k: 0 } },
      { kind: "add", id: 19, name: "Vägbotten", cmyk: { c: 0.1, m: 0.35, y: 0.5, k: 0 } }
    ]);
    expect(documentColors(doc)).toHaveLength(3);
    const motorway: LineSymbol = {
      id: "502000",
      code: { text: "502.0", main: 502, sub: 0 },
      name: "Motorväg",
      hidden: false,
      kind: "LINE",
      strokes: [
        { color: 19, width: 1.26, cap: "butt", join: "round" },
        { color: 8, width: 1.14, cap: "butt", join: "round" },
        { color: 2, width: 0.14, offset: 0.64, cap: "butt", join: "round" },
        { color: 2, width: 0.14, offset: -0.64, cap: "butt", join: "round" },
        { color: 2, width: 0.14, cap: "butt", join: "round" }
      ]
    };
    doc.symbols.push(encodeOcdSymbol(motorway, { number: 502000, variant: doc.variant, colors: documentColors(doc) }));
    const roundTripped = readMapFile(packOcdDocument(doc).bytes, "motorvag.ocd").symbols.get("502000") as LineSymbol;
    expect(roundTripped.extent).toBeCloseTo(0.71, 4);
    expect(roundTripped.strokes.map(st => ({
      color: st.color,
      width: Number(st.width.toFixed(3)),
      offset: Number((st.offset ?? 0).toFixed(3))
    }))).toEqual([
      { color: 19, width: 1.26, offset: 0 },
      { color: 8, width: 1.14, offset: 0 },
      { color: 2, width: 0.14, offset: 0.64 },
      { color: 2, width: 0.14, offset: -0.64 },
      { color: 2, width: 0.14, offset: 0 }
    ]);
  });
});

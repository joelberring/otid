/**
 * ADR-0196: OCAD 8–11. Samma testkarta byggd i version 9, 10 och 11 ska ge samma modell som i version 12; version 8 har
 * egen layout (färghuvud, inställningspost, 16-bitars symbolnummer) och provas för sig. Riktiga filer ur klubbarkivet provas
 * bara lokalt (real-map.test.ts med OTID_OLD_OCD_DIR) och committas aldrig.
 */
import { describe, expect, it } from "vitest";
import { MapFileError, readMapFile, type ParsedMap } from "../src";
import { areaBody8, buildOcd, buildOcd8, concat, element, ocdCoord, seededRandom, symbolBody, type Ocd8Spec } from "./ocd-builder";
import { GEOREF, SPEC, contour, dot, forest, label } from "./ocd-spec";

const strip = (map: ParsedMap) => ({ ...map, version: "" });

describe("OCAD 9–11", () => {
  const reference = strip(readMapFile(buildOcd({ ...SPEC, version: 12, subversion: 0 })));

  for (const version of [9, 10, 11]) {
    it(`läser version ${version} till samma modell som version 12`, () => {
      const map = readMapFile(buildOcd({ ...SPEC, version, subversion: 3 }), "gammal.ocd");
      expect(map.version).toBe(`OCAD ${version}.3`);
      expect(strip(map)).toEqual(reference);
    });
  }

  it("läser symbolbeskrivningen som Pascalsträng i version 9–10 och UTF-16 i 11", () => {
    const named = { ...contour, description: "Höjdkurva" };
    for (const version of [9, 10, 11]) {
      const map = readMapFile(buildOcd({ symbols: [named], version }));
      expect(map.symbols.get("101000")?.name).toBe("Höjdkurva");
    }
  });

  it("läser färgnamn och georeferens i Windows-1252", () => {
    const strings = [{ type: 9, value: "Täckande vitt\tn17\tc0\tm0\ty0\tk0\to0" }, GEOREF];
    const map = readMapFile(buildOcd({ ...SPEC, version: 10, strings, encoding: "WINDOWS_1252" }));
    expect(map.colors.map(color => color.name)).toEqual(["Täckande vitt"]);
    expect(map.georeference?.crs).toEqual({ kind: "EPSG", code: 3006 });
    expect(map.scale).toBe(15000);
  });

  it("läser ytsymbolens mönster från version 9:s position", () => {
    const pattern = element(4, 2, 0, 20, [ocdCoord(0, 0)]);
    const body = concat(symbolBody(36, { 800: 34, 816: 1, 818: 100, 820: 150, 830: pattern.length / 8 }), pattern);
    const area = { number: 211000, type: 3, body };
    for (const version of [9, 11, 12]) {
      const symbol = readMapFile(buildOcd({ symbols: [area], version })).symbols.get("211000");
      expect(symbol, `version ${version}`).toMatchObject({ kind: "AREA", pattern: { dx: 1, dy: 1.5, elements: [{ kind: "dot", diameter: 0.2 }] } });
    }
  });

  it("läser ytsymbolens mönster i version 8 (T2: StructMode vid 814, DataSize vid 824)", () => {
    // OCAD 8:s ytsymbol saknar kantlinje och FillOn/BorderOn som byte: AreaFlags, FillOn (16 bit), FillCol, raster,
    // StructMode, StructWidth, StructHeight, StructAngle, StructRes, DataSize och sedan ritdata. Positioner från 796.
    const pattern = element(4, 2, 0, 20, [ocdCoord(0, 0)]);
    const fields = new Uint8Array(30);
    const view = new DataView(fields.buffer);
    view.setUint16(2, 1, true); // FillOn
    view.setInt16(4, 34, true); // FillCol
    view.setInt16(18, 1, true); // StructMode
    view.setInt16(20, 100, true); // StructWidth
    view.setInt16(22, 150, true); // StructHeight
    view.setInt16(24, 300, true); // StructAngle 30°
    view.setUint16(28, pattern.length / 8, true); // DataSize
    const spec: Ocd8Spec = { colors: [{ number: 34, name: "Gul", cmyk: [0, 14, 40, 0] }], symbols: [{ number: 4040, type: 3, body: concat(fields, pattern) }] };
    expect(readMapFile(buildOcd8(spec)).symbols.get("404000")).toMatchObject({
      kind: "AREA", fill: 34, pattern: { dx: 1, dy: 1.5, angle: 30, elements: [{ kind: "dot", diameter: 0.2 }] }
    });
  });

  it("använder linjesymbolens hörn- och slutsymboler utan flaggor före version 11", () => {
    const corner = element(4, 2, 0, 40, [ocdCoord(0, 0)]);
    const body = concat(symbolBody(76, { 796: 2, 798: 20, 864: corner.length / 8 }), corner);
    const line = { number: 516000, type: 2, body };
    expect(readMapFile(buildOcd({ symbols: [line], version: 10 })).symbols.get("516000")).toMatchObject({ corner: { elements: [{ kind: "dot" }] } });
    // Version 11 och senare: flaggan saknas, så hörnsymbolen används inte.
    expect(readMapFile(buildOcd({ symbols: [line], version: 11 })).symbols.get("516000")).toMatchObject({ corner: undefined });
  });

  it("hänger aldrig och kastar bara MapFileError på slumpade version 9- och 11-filer", () => {
    const random = seededRandom(196);
    for (const version of [9, 11]) {
      const good = buildOcd({ ...SPEC, version });
      for (let round = 0; round < 100; round++) {
        const bytes = good.slice();
        const flips = 1 + Math.floor(random() * 40);
        for (let i = 0; i < flips; i++) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
        bytes[0] = 0xad; bytes[1] = 0x0c; bytes[4] = version; bytes[5] = 0;
        try { readMapFile(bytes); } catch (error) { expect(error, `v${version} runda ${round}`).toBeInstanceOf(MapFileError); }
      }
      for (const length of [10, 47, 200, good.length - 30]) expect(() => readMapFile(good.slice(0, length))).toThrow(MapFileError);
    }
  });
});

/** Version 8 använder 101.0 = 1010. */
const SPEC8: Ocd8Spec = {
  colors: [{ number: 54, name: "Lila", cmyk: [35, 85, 0, 0] }, { number: 2, name: "Svart", cmyk: [0, 0, 0, 100] }, { number: 34, name: "Gul 50%", cmyk: [0, 14, 40, 0] }],
  scale: 7500,
  realWorld: { x: 669000, y: 6574000, angle: 1.5 },
  symbols: [
    { ...contour, number: 1010, description: "Höjdkurva" },
    { ...dot, number: 1051 },
    { ...forest, number: 4060, body: areaBody8(forest.body) },
    { ...label, number: 9020 }
  ],
  objects: [
    { symbol: 1010, type: 2, coords: [ocdCoord(0, 0), ocdCoord(100, 0, 1), ocdCoord(200, 100, 2), ocdCoord(200, 200), ocdCoord(300, 200)] },
    { symbol: 1051, type: 1, angle: 900, coords: [ocdCoord(500, 600)] },
    { symbol: 4060, type: 3, coords: [ocdCoord(0, 0), ocdCoord(1000, 0), ocdCoord(1000, 1000), ocdCoord(0, 1000)] },
    { symbol: 9020, type: 4, coords: [ocdCoord(10, 20)], text: "Älvsjö" },
    { symbol: 9020, type: 4, coords: [ocdCoord(10, 20)], text: "Örby", ansi: true },
    { symbol: 1010, type: 2, deleted: true, coords: [ocdCoord(0, 0), ocdCoord(1, 1)] },
    { symbol: -2, type: 2, coords: [ocdCoord(0, 0), ocdCoord(1, 1)] }
  ]
};

describe("OCAD 8", () => {
  const map = readMapFile(buildOcd8(SPEC8), "gammal.ocd");

  it("läser färgerna ur färghuvudet", () => {
    expect(map.version).toBe("OCAD 8.0");
    expect(map.colors.map(color => [color.id, color.rank, color.name])).toEqual([[54, 0, "Lila"], [2, 1, "Svart"], [34, 2, "Gul 50%"]]);
    expect(map.colors[0]!.cmyk).toEqual({ c: 0.35, m: 0.85, y: 0, k: 0 });
    expect(map.colors[1]!.rgb).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("räknar om symbolnumren till version 9:s form och tolkar symbolerna", () => {
    expect(map.symbols.get("101000")).toMatchObject({ kind: "LINE", name: "Höjdkurva", code: { text: "101.0" }, strokes: [{ color: 2, width: 0.14 }] });
    expect(map.symbols.get("105001")).toMatchObject({ kind: "POINT", code: { text: "105.1" }, elements: [{ kind: "dot", diameter: 0.5 }] });
    expect(map.symbols.get("406000")).toMatchObject({ kind: "AREA", fill: 34, hatches: [{ color: 2, width: 0.4, spacing: 1.5, angle: 90 }] });
    expect(map.symbols.get("902000")).toMatchObject({ kind: "TEXT", fontFamily: "Arial", bold: true });
  });

  it("läser objekten, texter i UTF-16 och Windows-1252, och hoppar över borttagna", () => {
    expect(map.objects.map(object => object.kind)).toEqual(["line", "point", "area", "text", "text"]);
    expect(map.objects[0]).toMatchObject({ symbol: "101000", path: [{ type: "M" }, { type: "C", x: 2, y: 2 }, { type: "L", x: 3, y: 2 }] });
    expect(map.objects[1]).toEqual({ kind: "point", symbol: "105001", at: { x: 5, y: 6 }, angle: 90 });
    expect(map.objects.slice(3).map(object => object.kind === "text" && object.text)).toEqual(["Älvsjö", "Örby"]);
    expect(map.warnings.find(warning => warning.code === "OBJECT_WITHOUT_SYMBOL")?.count).toBe(1);
  });

  it("läser skalan och georeferensen ur inställningsposten (utan koordinatsystem)", () => {
    expect(map.scale).toBe(7500);
    expect(map.georeference).toMatchObject({ scale: 7500, refPoint: { easting: 669000, northing: 6574000 }, grivationDegrees: 1.5, crs: { kind: "UNKNOWN" } });
    expect(map.warnings.some(warning => warning.code === "CRS_UNKNOWN")).toBe(true);
    expect(readMapFile(buildOcd8({ ...SPEC8, realWorld: { x: 0, y: 0 } })).georeference).toBeNull();
  });

  it("hänger aldrig och kastar bara MapFileError på slumpade version 8-filer", () => {
    const good = buildOcd8(SPEC8);
    const random = seededRandom(8);
    for (let round = 0; round < 150; round++) {
      const bytes = good.slice();
      const flips = 1 + Math.floor(random() * 40);
      for (let i = 0; i < flips; i++) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
      bytes[0] = 0xad; bytes[1] = 0x0c; bytes[4] = 8; bytes[5] = 0;
      try { readMapFile(bytes); } catch (error) { expect(error, `runda ${round}`).toBeInstanceOf(MapFileError); }
    }
    for (const length of [10, 47, 100, 20000, good.length - 30]) expect(() => readMapFile(good.slice(0, length)), `längd ${length}`).toThrow(MapFileError);
  });
});

describe("OCAD 6 och 7", () => {
  it("ger ett tydligt besked", () => {
    for (const version of [6, 7]) {
      expect(() => readMapFile(buildOcd({ ...SPEC, version }))).toThrow(/OCAD \d stöds inte/);
    }
  });
});

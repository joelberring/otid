import { describe, expect, it } from "vitest";
import { MapFileError, mapPointToWgs84, readMapFile, wgs84ToMapPoint, type ParsedMap } from "../src";
import { buildOcd, concat, element, ocdCoord, seededRandom, symbolBody, type OcdSpec } from "./ocd-builder";

const COLORS = [
  { type: 10, value: "Purple\tn0\tv1\tc35.0\tm85.0\ty0.0\tk0.0" },
  { type: 9, value: "Lila\tn54\tc35\tm85\ty0\tk0\to0\tt100\tsPurple\tp100" },
  { type: 9, value: "Svart\tn2\tc0\tm0\ty0\tk100\to1\tt100" },
  { type: 9, value: "Gul 50%\tn34\tm14\ty40\tk0\tt50\tsPurple\tp0\tsOkänd\tp50" }
];

const GEOREF = { type: 1039, value: "\tm15000.000000\tg50.0000\tr1\tx675000\ty6570000\ta4.90000000\td250.00\te3006\ti13002" };

/** Linje 101.0 med bredd 0,14 mm i färg 2. */
const contour = { number: 101000, type: 2, body: symbolBody(80, { 796: 2, 798: 14, 800: 1 }) };
/** Punkt 105.100: svart prick, diameter 0,5 mm. */
const dot = {
  number: 105100, type: 1,
  body: (() => { const el = element(4, 2, 0, 50, [ocdCoord(0, 0)]); return concat(symbolBody(4, { 796: el.length / 8 }), el); })()
};
/** Yta 406.0 med fyllning i färg 34 och raster 90°. */
const forest = {
  number: 406000, type: 3,
  body: symbolBody(40, { 800: 34, 802: 1, 804: 2, 806: 40, 808: 150, 810: 900 }, view => view.setUint8(814 - 796, 1))
};
/** Text 902.0, 8 pt Arial. */
const label = {
  number: 902000, type: 4,
  body: symbolBody(60, { 828: 2, 830: 80, 832: 700 }, view => { view.setUint8(0, 5); "Arial".split("").forEach((c, i) => view.setUint8(1 + i, c.charCodeAt(0))); })
};

const SPEC: OcdSpec = {
  strings: [...COLORS, GEOREF],
  symbols: [contour, dot, forest, label, { number: 999000, type: 9 }],
  objects: [
    // Linje: (0,0) – kurva med styrpunkter (100,0) och (200,100) till (200,200) – (300,200). Enhet 0,01 mm.
    { symbol: 101000, type: 2, coords: [ocdCoord(0, 0), ocdCoord(100, 0, 1), ocdCoord(200, 100, 2), ocdCoord(200, 200), ocdCoord(300, 200)] },
    { symbol: 105100, type: 1, angle: 900, coords: [ocdCoord(500, 600)] },
    // Yta 10×10 mm med ett hål 2×2 mm.
    {
      symbol: 406000, type: 3, coords: [
        ocdCoord(0, 0), ocdCoord(1000, 0), ocdCoord(1000, 1000), ocdCoord(0, 1000),
        ocdCoord(200, 200, 0, 2), ocdCoord(400, 200), ocdCoord(400, 400)
      ]
    },
    { symbol: 902000, type: 4, coords: [ocdCoord(10, 20)], text: "Djurgården\r\nnorra" },
    { symbol: 101000, type: 2, status: 2, coords: [ocdCoord(0, 0), ocdCoord(1, 1)] },
    { symbol: 101000, type: 2, status: 3, coords: [ocdCoord(0, 0), ocdCoord(1, 1)] },
    { symbol: -2, type: 3, coords: [ocdCoord(0, 0), ocdCoord(1, 1), ocdCoord(1, 0)] },
    { symbol: 555000, type: 2, coords: [ocdCoord(0, 0), ocdCoord(1, 1)] },
    { symbol: 101000, type: 9, coords: [ocdCoord(0, 0)] }
  ]
};

function read(spec: OcdSpec = SPEC): ParsedMap {
  return readMapFile(buildOcd(spec), "test.ocd");
}

describe("OCAD-läsaren", () => {
  it("känner igen formatet och versionen", () => {
    const map = read();
    expect(map.format).toBe("OCD");
    expect(map.version).toBe("OCAD 2018.8");
    expect(read({ ...SPEC, version: 12, subversion: 0 }).version).toBe("OCAD 12.0");
  });

  it("läser färgtabellen i filens ordning med dekorfärger", () => {
    const { colors } = read();
    expect(colors.map(color => [color.id, color.rank, color.name])).toEqual([[54, 0, "Lila"], [2, 1, "Svart"], [34, 2, "Gul 50%"]]);
    expect(colors[0]!.cmyk).toEqual({ c: 0.35, m: 0.85, y: 0, k: 0 });
    expect(colors[0]!.rgb.r).toBeCloseTo(0.65, 9);
    expect(colors[0]!.spot).toEqual({ name: "Purple", overprint: false });
    expect(colors[1]!.spot).toBeUndefined();
    expect(colors[1]!.rgb).toEqual({ r: 0, g: 0, b: 0 });
    expect(colors[2]!.opacity).toBe(0.5);
    // Okänd dekorfärg (finns inte i strängtyp 10) tas inte med; Purple 0 % blir kvar som enda separation.
    expect(colors[2]!.spot).toEqual({ name: "Purple 0 %", overprint: false });
  });

  it("läser symbolnummer som OCAD visar dem", () => {
    const map = read();
    expect(map.symbols.get("101000")?.code).toEqual({ text: "101.0", main: 101, sub: 0 });
    expect(map.symbols.get("105100")?.code).toEqual({ text: "105.100", main: 105, sub: 100 });
    expect(map.symbols.get("101000")?.name).toBe("Symbol 101000");
    expect(map.symbols.has("999000")).toBe(false);
    expect(map.warnings.find(w => w.code === "UNKNOWN_SYMBOL_TYPE")?.count).toBe(1);
  });

  it("tolkar linje-, punkt-, yt- och textsymboler", () => {
    const map = read();
    expect(map.symbols.get("101000")).toMatchObject({ kind: "LINE", strokes: [{ color: 2, width: 0.14, cap: "round", join: "round" }] });
    expect(map.symbols.get("105100")).toMatchObject({ kind: "POINT", elements: [{ kind: "dot", color: 2, diameter: 0.5, center: { x: 0, y: 0 } }] });
    expect(map.symbols.get("406000")).toMatchObject({ kind: "AREA", fill: 34, hatches: [{ color: 2, width: 0.4, spacing: 1.5, angle: 90 }] });
    const text = map.symbols.get("902000");
    expect(text).toMatchObject({ kind: "TEXT", color: 2, fontFamily: "Arial", bold: true, italic: false });
    expect(text?.kind === "TEXT" && text.size).toBeCloseTo(8 * 25.4 / 72, 9);
  });

  it("läser bézierkurvor ur koordinaternas flaggor (y uppåt, ingen omvändning)", () => {
    expect(read().objects[0]).toEqual({
      kind: "line", symbol: "101000",
      path: [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 1, y1: 0, x2: 2, y2: 1, x: 2, y: 2 }, { type: "L", x: 3, y: 2 }]
    });
  });

  it("delar ytor i ytterkant och hål", () => {
    const area = read().objects[2]!;
    expect(area).toEqual({
      kind: "area", symbol: "406000", angle: 0,
      rings: [
        [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 10, y: 10 }, { type: "L", x: 0, y: 10 }],
        [{ type: "M", x: 2, y: 2 }, { type: "L", x: 4, y: 2 }, { type: "L", x: 4, y: 4 }]
      ]
    });
  });

  it("läser punkter med vinkel och texter", () => {
    const [, point, , text] = read().objects;
    expect(point).toEqual({ kind: "point", symbol: "105100", at: { x: 5, y: 6 }, angle: 90 });
    expect(text).toEqual({ kind: "text", symbol: "902000", at: { x: 0.1, y: 0.2 }, angle: 0, text: "Djurgården\nnorra" });
  });

  it("räknar inte dolda och borttagna objekt och räknar övriga överhoppade", () => {
    const map = read();
    expect(map.objects).toHaveLength(4);
    const count = (code: string) => map.warnings.find(w => w.code === code)?.count;
    expect(count("OBJECT_WITHOUT_SYMBOL")).toBe(1);
    expect(count("UNKNOWN_SYMBOL")).toBe(1);
    expect(count("UNKNOWN_OBJECT_TYPE")).toBe(1);
  });

  it("läser georeferensen ur strängparameter 1039 och räknar fram och tillbaka", () => {
    const map = read();
    expect(map.scale).toBe(15000);
    expect(map.georeference).toEqual({
      scale: 15000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6570000 },
      mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 4.9, combinedScaleFactor: 1
    });
    const origin = mapPointToWgs84(map.georeference!, { x: 0, y: 0 });
    expect(origin.latitude).toBeCloseTo(59.23278649, 7);
    expect(origin.longitude).toBeCloseTo(18.06742805, 7);
    const point = { x: 123.45, y: 678.9 };
    const back = wgs84ToMapPoint(map.georeference!, mapPointToWgs84(map.georeference!, point));
    expect(Math.hypot(back.x - point.x, back.y - point.y)).toBeLessThan(0.001);
  });

  it("känner igen SWEREF 99 TM ur OCAD:s rutnätskod när EPSG saknas, annars okänt", () => {
    const withoutEpsg = { type: 1039, value: GEOREF.value.replace("\te3006", "") };
    expect(read({ ...SPEC, strings: [...COLORS, withoutEpsg] }).georeference?.crs).toEqual({ kind: "EPSG", code: 3006 });
    const unknown = { type: 1039, value: GEOREF.value.replace("\te3006\ti13002", "\ti99999") };
    const map = read({ ...SPEC, strings: [...COLORS, unknown] });
    expect(map.georeference?.crs.kind).toBe("UNKNOWN");
    expect(map.warnings.some(w => w.code === "CRS_UNKNOWN")).toBe(true);
    expect(() => mapPointToWgs84(map.georeference!, { x: 0, y: 0 })).toThrow(/stöds inte/);
  });

  it("har ingen georeferens när kartan inte är i verkliga koordinater, och tomma lager går bra", () => {
    const local = { type: 1039, value: GEOREF.value.replace("\tr1", "\tr0") };
    expect(read({ ...SPEC, strings: [local] }).georeference).toBeNull();
    const empty = read({});
    expect(empty.objects).toEqual([]);
    expect(empty.colors).toEqual([]);
    expect(empty.bounds).toBeNull();
    expect(empty.scale).toBe(10000);
  });

  it("ger bounds ur objekten", () => {
    expect(read().bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });
});

describe("OCAD-läsaren på trasiga filer", () => {
  const good = buildOcd(SPEC);

  it("kastar UNSUPPORTED_VERSION för OCAD 11 och äldre", () => {
    for (const version of [6, 8, 9, 10, 11]) {
      expect(() => read({ ...SPEC, version })).toThrow(expect.objectContaining({ code: "UNSUPPORTED_VERSION" }) as Error);
    }
  });

  it("kastar NOT_A_MAP_FILE för fel magi", () => {
    const wrong = good.slice();
    wrong[1] = 0x0d;
    expect(() => readMapFile(wrong)).toThrow(expect.objectContaining({ code: "NOT_A_MAP_FILE" }) as Error);
  });

  it("kastar TRUNCATED för en avkortad fil, var den än är avkortad", () => {
    for (const length of [2, 10, 47, 100, good.length - 4000, good.length - 50, good.length - 1]) {
      expect(() => readMapFile(good.slice(0, length)), `längd ${length}`).toThrow(MapFileError);
    }
  });

  it("avbryter index som pekar i cirkel", () => {
    const looped = good.slice();
    const view = new DataView(looped.buffer);
    const objectBlock = view.getInt32(12, true);
    view.setInt32(objectBlock, objectBlock, true);
    expect(() => readMapFile(looped)).toThrow(expect.objectContaining({ code: "INVALID" }) as Error);
  });

  it("hänger aldrig och kastar bara MapFileError på 200 slumpade filer", () => {
    const random = seededRandom(59);
    for (let round = 0; round < 200; round++) {
      let bytes: Uint8Array;
      if (round % 2 === 0) {
        // Slumpbytes med OCAD-huvud och rimlig version, så att läsaren kommer förbi första kontrollen.
        bytes = new Uint8Array(64 + Math.floor(random() * 20000));
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256);
        bytes[0] = 0xad; bytes[1] = 0x0c; bytes[4] = 0xe2; bytes[5] = 0x07;
      } else {
        // En korrekt fil med slumpade bytebyten.
        bytes = good.slice();
        const flips = 1 + Math.floor(random() * 40);
        for (let i = 0; i < flips; i++) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
        bytes[0] = 0xad; bytes[1] = 0x0c;
      }
      const start = performance.now();
      try {
        const map = readMapFile(bytes);
        expect(map.objects.length).toBeLessThan(100_000);
      } catch (error) {
        expect(error, `runda ${round}`).toBeInstanceOf(MapFileError);
      }
      expect(performance.now() - start, `runda ${round}`).toBeLessThan(1000);
    }
  });
});

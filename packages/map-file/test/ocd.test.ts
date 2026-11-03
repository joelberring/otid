import { describe, expect, it } from "vitest";
import { MapFileError, mapPointToWgs84, readMapFile, wgs84ToMapPoint, type ParsedMap } from "../src";
import { buildOcd, seededRandom, type OcdSpec } from "./ocd-builder";
import { COLORS, GEOREF, SPEC } from "./ocd-spec";

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
    expect(colors[0]!.rgb).toEqual({ r: 171 / 255, g: 74 / 255, b: 156 / 255 });
    expect(colors[0]!.spot).toEqual({ name: "Purple", overprint: false, separations: [{ name: "Purple", factor: 1, cmyk: { c: 0.35, m: 0.85, y: 0, k: 0 } }] });
    expect(colors[1]!.spot).toBeUndefined();
    expect(colors[1]!.rgb).toEqual({ r: 0, g: 0, b: 0 });
    expect(colors[2]!.opacity).toBe(0.5);
    // Okänd dekorfärg (finns inte i strängtyp 10) tas inte med; Purple 0 % blir kvar som enda separation.
    // Andelen 0 % behålls i separationerna: färgen slår ut den plåten (steg 65).
    expect(colors[2]!.spot).toEqual({ name: "Purple 0 %", overprint: false, separations: [{ name: "Purple", factor: 0, cmyk: { c: 0.35, m: 0.85, y: 0, k: 0 } }] });
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

  it("kastar UNSUPPORTED_VERSION för OCAD 7 och äldre", () => {
    for (const version of [6, 7]) {
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

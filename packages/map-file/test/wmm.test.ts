import { describe, expect, it } from "vitest";
import { decimalYear, magneticDeclination } from "../src";

/**
 * ADR-0223: missvisningen med WMM 2025. Värdena är räknade med pygeomag (en oberoende Python-implementation av WMM med samma
 * koefficienter) för Stockholm, Kiruna, Malmö, Nya Zeeland och Kanadas arktis, på marken och 28 km upp.
 */
const REFERENCE: readonly (readonly [number, number, number, number, number])[] = [
    [59.33, 18.07, 0.0, 2025.0, 7.4558],
    [67.85, 20.2, 0.0, 2025.0, 10.8330],
    [55.6, 13.0, 0.0, 2025.0, 5.1257],
    [-45.0, 170.0, 0.0, 2025.0, 25.3532],
    [80.0, -100.0, 0.0, 2025.0, -25.9279],
    [59.33, 18.07, 28.0, 2025.0, 7.3601],
    [67.85, 20.2, 28.0, 2025.0, 10.6751],
    [55.6, 13.0, 28.0, 2025.0, 5.0547],
    [-45.0, 170.0, 28.0, 2025.0, 25.2969],
    [80.0, -100.0, 28.0, 2025.0, -25.1181],
    [59.33, 18.07, 0.0, 2029.5, 8.2111],
    [67.85, 20.2, 0.0, 2029.5, 11.9280],
    [55.6, 13.0, 0.0, 2029.5, 5.8218],
    [-45.0, 170.0, 0.0, 2029.5, 25.7444],
    [80.0, -100.0, 0.0, 2029.5, -21.4274],
    [59.33, 18.07, 28.0, 2029.5, 8.1129],
    [67.85, 20.2, 28.0, 2029.5, 11.7655],
    [55.6, 13.0, 28.0, 2029.5, 5.7492],
    [-45.0, 170.0, 28.0, 2029.5, 25.6858],
    [80.0, -100.0, 28.0, 2029.5, -20.8156]
];

describe("World Magnetic Model 2025", () => {
  it("ger samma missvisning som referensen (på 0,001°)", () => {
    for (const [lat, lon, height, year, degrees] of REFERENCE) {
      expect(magneticDeclination(lat, lon, year, height).degrees, `${lat}, ${lon}, ${height} km, ${year}`).toBeCloseTo(degrees, 3);
    }
  });

  it("decimalt år och giltigheten", () => {
    expect(decimalYear("2026-01-01")).toBeCloseTo(2026.0014, 3);
    expect(decimalYear("2026-07-02")).toBeCloseTo(2026.5, 2);
    expect(magneticDeclination(59.33, 18.07, 2026.9).valid).toBe(true);
    expect(magneticDeclination(59.33, 18.07, 2031).valid).toBe(false);
    expect(() => magneticDeclination(Number.NaN, 18, 2026)).toThrow(RangeError);
  });
});

describe("ADR-0223: kartans nord mot dagens", () => {
  it("en ny karta med dagens missvisning har skillnaden noll, en äldre med 2° mindre skillnaden 2°", async () => {
    const { mapNorthFacts, newMapFile, readMapFile, declinationAt } = await import("../src");
    const today = declinationAt(59.3, 18.0, "2026-11-10");
    expect(today).toBeGreaterThan(6);
    expect(today).toBeLessThan(9);
    const refPoint = { easting: 674000, northing: 6578000 };
    const georefOf = (declinationDegrees: number) => readMapFile(newMapFile({ symbolSet: "ISOM2017-2", scale: 10000, refPoint, declinationDegrees }),
      "ny.omap").georeference!;
    const now = mapNorthFacts(georefOf(7.4), "2026-11-10")!;
    expect(now.mapDeclination).toBeCloseTo(7.4, 1);
    const old = mapNorthFacts(georefOf(now.magnetic.degrees - 2), "2026-11-10")!;
    expect(old.difference).toBeCloseTo(2, 1);
  });

  it("nordlinjerna (601) i kartan går före filens vinkel (ägaren 2026-11-10: Högdalen har vinkeln 0 men linjerna 4,4° snett)", async () => {
    const { mapNorthFacts, northLineDegrees } = await import("../src");
    const symbols = new Map([["n", { id: "n", code: { text: "601", main: 601 }, name: "Nordlinje", hidden: false, kind: "LINE" }]]);
    const line = (dx: number) => ({ kind: "line", symbol: "n", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: dx, y: 100 }] });
    const map = { symbols, objects: [line(7.7), line(7.69), { ...line(7.7), path: [{ type: "M", x: 7.7, y: 100 }, { type: "L", x: 0, y: 0 }] }, line(0.5)] } as never;
    expect(northLineDegrees(map)).toBeCloseTo(4.4, 1);
    expect(northLineDegrees({ symbols, objects: [] } as never)).toBeUndefined();
    const georef = { scale: 15000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6570000 }, mapRefPoint: { x: 0, y: 0 },
      grivationDegrees: 0, combinedScaleFactor: 1 } as const;
    const plain = mapNorthFacts(georef, "2026-11-10")!, drawn = mapNorthFacts(georef, "2026-11-10", 4.4)!;
    expect(drawn.mapDeclination - plain.mapDeclination).toBeCloseTo(4.4, 6);
  });
});

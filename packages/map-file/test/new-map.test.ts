import { describe, expect, it } from "vitest";
import {
  applyMapRevision, newMapFile, NewMapError, readMapFile, sha256Hex, SYMBOL_SETS, wgs84ToProjected, type LineSymbol, type PointSymbol
} from "../src";
import { gridConvergenceDegrees } from "../src/template/new-map";

/** Kungshatt i Mälaren, ungefär. */
const KUNGSHATT = wgs84ToProjected({ kind: "EPSG", code: 3006 }, 59.307, 17.79);
const meta = { author: "konto-1", at: "2026-11-08T07:00:00Z" } as const;

describe("ADR-0219 K1: ny karta (.omap med O-Tids symbolset)", () => {
  for (const id of ["ISOM2017-2", "ISSPROM2019-2"] as const) {
    it(`${id}: läses tillbaka med alla symboler och färger, inga varningar`, () => {
      const set = SYMBOL_SETS[id];
      const bytes = newMapFile({ symbolSet: id, scale: set.scales[0]!.scale, refPoint: KUNGSHATT, declinationDegrees: 6.5 });
      const map = readMapFile(bytes, "ny.omap", { sources: true });
      expect(map.format).toBe("OMAP");
      expect(map.warnings).toEqual([]);
      expect(map.objects).toEqual([]);
      expect(map.colors).toHaveLength(set.colors.length);
      expect(map.symbols.size).toBeGreaterThanOrEqual(set.symbols.length);
      const codes = [...map.symbols.values()].filter(symbol => symbol.code.main > 0)
        .map(symbol => `${symbol.code.main}${symbol.code.sub ? `.${symbol.code.sub}` : ""}`);
      for (const symbol of set.symbols) expect(codes).toContain(symbol.code);
      // Koderna är unika.
      expect(new Set(set.symbols.map(symbol => symbol.code)).size).toBe(set.symbols.length);
    });
  }

  it("georeferensen: SWEREF 99 TM, referenspunkten i 0,0 och grivationen = missvisning − meridiankonvergens", () => {
    const bytes = newMapFile({ symbolSet: "ISOM2017-2", scale: 10000, refPoint: KUNGSHATT, declinationDegrees: 6.5 });
    const map = readMapFile(bytes, "ny.omap");
    expect(map.scale).toBe(10000);
    const georef = map.georeference!;
    expect(georef.crs).toEqual({ kind: "EPSG", code: 3006 });
    expect(georef.refPoint.easting).toBeCloseTo(KUNGSHATT.easting, 1);
    expect(georef.refPoint.northing).toBeCloseTo(KUNGSHATT.northing, 1);
    expect(georef.mapRefPoint).toEqual({ x: 0, y: 0 });
    // Öster om medelmeridianen 15°: konvergensen är ungefär (λ − 15°)·sin φ ≈ 2,4°.
    const convergence = gridConvergenceDegrees(KUNGSHATT);
    expect(convergence).toBeGreaterThan(2.2);
    expect(convergence).toBeLessThan(2.6);
    expect(georef.grivationDegrees).toBeCloseTo(6.5 - convergence, 1);
  });

  it("1:10 000 förstorar skogssymbolerna 1,5 gånger; sprint 1:3 000 har samma mått som 1:4 000", () => {
    const width = (id: "ISOM2017-2" | "ISSPROM2019-2", scale: number, code: number) => {
      const map = readMapFile(newMapFile({ symbolSet: id, scale, refPoint: KUNGSHATT }), "ny.omap");
      const symbol = [...map.symbols.values()].find(entry => entry.code.main === code && entry.code.sub === 0) as LineSymbol;
      return symbol.strokes[0]!.width;
    };
    expect(width("ISOM2017-2", 15000, 101)).toBeCloseTo(0.14, 3);
    expect(width("ISOM2017-2", 10000, 101)).toBeCloseTo(0.21, 3);
    expect(width("ISSPROM2019-2", 3000, 515)).toBeCloseTo(width("ISSPROM2019-2", 4000, 515), 6);
    const map = readMapFile(newMapFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: KUNGSHATT }), "ny.omap");
    const boulder = [...map.symbols.values()].find(entry => entry.code.main === 204) as PointSymbol;
    expect(boulder.elements).toMatchObject([{ kind: "dot", diameter: 0.4 }]);
  });

  it("tar emot nya objekt via ändringssatsen (som kartprojektets synk)", () => {
    const bytes = newMapFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: KUNGSHATT });
    const before = readMapFile(bytes, "ny.omap");
    const symbolId = (code: number) => [...before.symbols.values()].find(entry => entry.code.main === code && entry.code.sub === 0)!.id;
    const result = applyMapRevision(bytes, { baseFileSha256: sha256Hex(bytes), format: "OMAP", changes: [
      { kind: "add", ...meta, id: "a", symbol: symbolId(204), geometry: { kind: "point", at: { x: 1, y: 2 } } },
      { kind: "add", ...meta, id: "b", symbol: symbolId(505), geometry: { kind: "line", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 5 }] } }
    ] });
    if (!result.ok) throw new Error(JSON.stringify(result.refusals));
    const after = readMapFile(result.bytes, "ny.omap");
    expect(after.objects.map(object => object.kind)).toEqual(["point", "line"]);
    expect(after.symbols.size).toBe(before.symbols.size);
  });

  it("vägrar en skala normen inte har och en punkt utanför Sverige", () => {
    expect(() => newMapFile({ symbolSet: "ISSPROM2019-2", scale: 10000, refPoint: KUNGSHATT })).toThrow(NewMapError);
    expect(() => newMapFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: { easting: 0, northing: 0 } })).toThrow(NewMapError);
  });
});

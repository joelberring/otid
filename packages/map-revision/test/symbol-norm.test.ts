import { describe, expect, it } from "vitest";
import { applyMapSymbolReplacements, newMapFile, readMapFile, SYMBOL_SETS, withSymbolReplacements, type ParsedMap, type SymbolDef } from "@o-tid/map-file";
import { checkSymbolNorm, ISSPROM_SYMBOLS, ISSPROM_SYMBOL_NORM, missingNormSymbols, normSymbolAdditions, normSymbolFixes, tintOf } from "../src";

const POINT = { easting: 660_000, northing: 6_575_000 };
const SPRINT = SYMBOL_SETS["ISSPROM2019-2"], FOREST = SYMBOL_SETS["ISOM2017-2"];
const sprintBytes = newMapFile({ symbolSet: "ISSPROM2019-2", scale: 4000, refPoint: POINT });
const used = (map: Pick<ParsedMap, "symbols">, unused: readonly string[] = []) =>
  new Map([...map.symbols.values()].map(symbol => [symbol.id, unused.includes(symbol.code.text) ? 0 : 1]));

/**
 * Som ägarens «Liljeholmen och Gröndal» (O-Tids sprintmall före 2026-11-23): helsvart byggnad, 521.1 oanvänd, trappan med
 * mittlinje, kant belagd yta 0,14 mm, berghäll svart 20 %, utan sprintnormens egna symboler (521.1 och 501.1 fanns).
 */
function ownerLike(): ParsedMap {
  const old: SymbolDef[] = [
    { code: "521", name: "Byggnad", kind: "area", fill: "black" },
    { code: "532", name: "Trappa", kind: "line", color: "black", width: 0.14, mid: { elements: [{ kind: "line", color: "black", width: 0.14, points: [[0, 0.5], [0, -0.5]] }], spacing: 0.5 } },
    { code: "501.1", name: "Kant, hårdgjord yta", kind: "line", color: "black", width: 0.14 },
    { code: "214", name: "Kal berghäll", kind: "area", fill: "black20" }
  ];
  const written = applyMapSymbolReplacements(sprintBytes, old.map(def => ({ code: def.code, def, palette: FOREST.colors })));
  if (!written.ok) throw new Error(written.message);
  return readMapFile(written.bytes, "liljeholmen.omap");
}

describe("symbolerna mot ISSprOM 2019-2", () => {
  it("O-Tids sprintmall följer tabellen och har alla normens symboler", () => {
    const map = readMapFile(sprintBytes, "ny.omap");
    expect(checkSymbolNorm({ ...map, counts: used(map) }, true)).toEqual([]);
    expect(missingNormSymbols(map.symbols)).toEqual([]);
    // Varje rad i jämförelsetabellen finns i normens lista, med källa.
    for (const spec of ISSPROM_SYMBOL_NORM) {
      expect(ISSPROM_SYMBOLS.some(entry => entry.code === spec.code)).toBe(true);
      expect(spec.source).toMatch(/^https:\/\/omapwiki\.orienteering\.sport\//);
    }
  });

  it("ägarens karta: byggnaden helsvart utan kant, trappan med linje, kanten 0,14 mm, berghällen 20 %", () => {
    const map = ownerLike();
    const issues = checkSymbolNorm({ ...map, counts: used(map, ["521.1"]) }, true);
    const by = (code: string) => issues.find(issue => issue.code === code);
    expect(by("521")?.problems).toEqual([{ kind: "FILL", base: "black", tints: [0.5], found: { base: "black", tint: 1 } }, { kind: "OUTLINE" }]);
    expect(by("521")).toMatchObject({ fixable: true, outlines: true });
    expect(by("532")?.problems).toEqual([{ kind: "STAIR_BAND", base: "brown", tint: 0.3 }, { kind: "STAIR_SIDES" }]);
    expect(by("501.1")?.problems).toEqual([{ kind: "LINE_WIDTH", width: 0.18, found: 0.14 }]);
    expect(by("214")?.problems[0]).toMatchObject({ kind: "FILL", found: { base: "black", tint: 0.2 } });
    expect(issues.every(issue => issue.fixable)).toBe(true);
    // Skogskartor har ingen tabell här.
    expect(checkSymbolNorm({ ...map, counts: used(map) }, false)).toEqual([]);
  });

  it("rättningen: byggnaden blir grå utan egen kant (kartan har 521.1), trappan steg; sedan bara kanten kvar", () => {
    const map = ownerLike();
    const fixed = withSymbolReplacements(map, normSymbolFixes(map.symbols, { replace: ["521", "532", "501.1", "214"] }));
    const issues = checkSymbolNorm({ ...fixed, counts: used(map, ["521.1"]) }, true);
    expect(issues.map(issue => [issue.code, issue.problems.map(problem => problem.kind)])).toEqual([["521", ["OUTLINE"]]]);
    // Med kantlinjerna ritade (521.1 används) följer kartan tabellen.
    expect(checkSymbolNorm({ ...fixed, counts: used(map) }, true)).toEqual([]);
  });

  it("trappans band under belagd yta i färgordningen (ägaren 2026-11-23: «brunt 30 i trappa ska ligga över andra ytor») rättas", () => {
    // Trappan som i mallen före 2026-11-23: bandet i den vanliga bruna 30 %, under 501 i brunt 50 % (där trapporna ligger).
    const old = { ...SPRINT.symbols.find(symbol => symbol.code === "532")!, color: "brown30" } as SymbolDef;
    const written = applyMapSymbolReplacements(sprintBytes, [{ code: "532", def: old, palette: SPRINT.colors }]);
    if (!written.ok) throw new Error(written.message);
    const map = readMapFile(written.bytes, "liljeholmen.omap");
    const issue = checkSymbolNorm({ ...map, counts: used(map) }, true).find(row => row.code === "532");
    expect(issue?.problems).toEqual([{ kind: "STAIR_ORDER", above: ["501", "501.3", "512.3", "521", "522"] }]);
    expect(issue?.fixable).toBe(true);
    const fixed = withSymbolReplacements(map, normSymbolFixes(map.symbols, { replace: ["532"] }));
    expect(checkSymbolNorm({ ...fixed, counts: used(map) }, true).find(row => row.code === "532")).toBeUndefined();
  });

  it("saknade normsymboler läggs till, aldrig de som finns; 509 räcker för 509.1", () => {
    const forest = readMapFile(newMapFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: POINT }), "skog.omap");
    const missing = missingNormSymbols(forest.symbols).map(row => row.code);
    expect(missing).toEqual(expect.arrayContaining(["105.2", "321", "501.3", "512.2", "533", "541", "545"]));
    expect(missing).not.toContain("509.1");
    expect(missing).not.toContain("521");
    const added = withSymbolReplacements(forest, normSymbolAdditions(forest, missing));
    // Ett tillägg lägger aldrig in färger: 501.3 (brunt 30 %), 509.2 (svart 50 %) och 512.3 (vit lägre nivå) väntar tills en rättning lagt in dem.
    expect(missingNormSymbols(added.symbols).map(row => row.code)).toEqual(["501.3", "509.2", "512.3"]);
    expect(added.symbols.size).toBeGreaterThan(forest.symbols.size);
  });

  it("färgandelen läses ur CMYK", () => {
    const color = (c: number, m: number, y: number, k: number) => ({ id: 0, name: "", rank: 0, cmyk: { c, m, y, k }, rgb: { r: 0, g: 0, b: 0 }, opacity: 1 });
    expect(tintOf(color(0, 0, 0, 0.5))).toEqual({ base: "black", tint: 0.5 });
    expect(tintOf(color(0, 0.28, 0.5, 0.09))).toEqual({ base: "brown", tint: 0.5 });
    expect(tintOf(color(0.46, 0, 0.55, 0))).toEqual({ base: "green", tint: 0.6 });
    expect(tintOf(color(0.35, 0, 1, 0.5))).toBeUndefined();
  });

  it("listan har varje nummer en gång och mallen har dem alla", () => {
    expect(new Set(ISSPROM_SYMBOLS.map(entry => entry.code)).size).toBe(ISSPROM_SYMBOLS.length);
    expect(ISSPROM_SYMBOLS.filter(entry => !SPRINT.symbols.some(symbol => symbol.code === entry.code)).map(entry => entry.code)).toEqual([]);
  });
});

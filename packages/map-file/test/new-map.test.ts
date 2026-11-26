import { describe, expect, it } from "vitest";
import {
  applyMapRevision, newMapFile, NewMapError, readMapFile, sha256Hex, SYMBOL_SETS, wgs84ToProjected, type AreaSymbol, type LineSymbol, type PointSymbol
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

  it("ISSprOM: byggnaden är grå yta med svart kant i en kombinerad symbol, trappan finns i fyra bredder", () => {
    const map = readMapFile(newMapFile({ symbolSet: "ISSPROM2019-2", scale: 4000, refPoint: KUNGSHATT }), "ny.omap");
    const byCode = (code: string) => [...map.symbols.values()].find(symbol => `${symbol.code.main}${symbol.code.sub ? `.${symbol.code.sub}` : ""}` === code);
    const building = byCode("521");
    expect(building?.kind).toBe("COMBINED");
    const parts = building?.kind === "COMBINED" ? building.parts.map(id => map.symbols.get(id)!) : [];
    const area = parts.find(part => part.kind === "AREA"), line = parts.find(part => part.kind === "LINE");
    const black = map.colors.find(color => color.name === "Svart")!, grey = map.colors.find(color => color.name === "Svart 50 %")!;
    expect(area?.fill).toBe(grey.id);
    expect(line?.strokes).toEqual([expect.objectContaining({ color: black.id, width: 0.14 })]);
    expect(map.colors.findIndex(color => color.id === grey.id)).toBeGreaterThan(map.colors.findIndex(color => color.id === black.id));
    // Trappan som i Mappers ISSprOM 2019-2: band i brunt 30 %, svarta kantlinjer 0,1 mm och steg 0,1 mm var 0,5 mm.
    const brown30 = map.colors.find(color => color.name === "Brun 30 % (trappa)")!;
    for (const [code, band, side, step] of [["532", 0.4, 0.25, 0.25], ["532.1", 0.5, 0.25, 0.3], ["532.2", 0.75, 0.375, 0.4], ["532.3", 1, 0.5, 0.55]] as const) {
      const stair = byCode(code) as LineSymbol | undefined;
      expect(stair?.strokes, code).toEqual([expect.objectContaining({ color: brown30.id, width: band }),
        expect.objectContaining({ color: black.id, width: 0.1, offset: side }), expect.objectContaining({ color: black.id, width: 0.1, offset: -side })]);
      expect(stair?.repeated?.spacing).toBeCloseTo(0.5, 6);
      expect(stair?.repeated?.endLength).toBeCloseTo(0.05, 6);
      expect(stair?.repeated?.minimum).toBe(3);
      expect(JSON.stringify(stair?.repeated?.elements)).toContain(String(step));
    }
  });

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

  it("1:10 000 förstorar skogssymbolerna 1,5 gånger; sprint 1:4 000 skalar ärvda 1,5× och 1:3 000 skalar 4/3", () => {
    const lineOf = (id: "ISOM2017-2" | "ISSPROM2019-2", scale: number, code: number) => {
      const map = readMapFile(newMapFile({ symbolSet: id, scale, refPoint: KUNGSHATT }), "ny.omap");
      return [...map.symbols.values()].find(entry => entry.code.main === code && entry.code.sub === 0) as LineSymbol;
    };
    const width = (id: "ISOM2017-2" | "ISSPROM2019-2", scale: number, code: number) => lineOf(id, scale, code).strokes[0]!.width;
    expect(width("ISOM2017-2", 15000, 101)).toBeCloseTo(0.14, 3);
    expect(width("ISOM2017-2", 10000, 101)).toBeCloseTo(0.21, 3);
    // Ärvda symboler i ISSprOM 1:4 000 skalas 1,5× från ISOM 1:15 000: 101 0,21 mm, 505 0,375 mm, 516 0,21 mm, 204 0,60 mm.
    expect(width("ISSPROM2019-2", 4000, 101)).toBeCloseTo(0.21, 3);
    expect(width("ISSPROM2019-2", 4000, 505)).toBeCloseTo(0.375, 3);
    expect(width("ISSPROM2019-2", 4000, 516)).toBeCloseTo(0.21, 3);
    // ISSprOM 1:3 000 förstoras proportionellt med 4/3.
    expect(width("ISSPROM2019-2", 3000, 101)).toBeCloseTo(0.28, 3);
    expect(width("ISSPROM2019-2", 3000, 515)).toBeCloseTo(width("ISSPROM2019-2", 4000, 515) * (4 / 3), 3);

    const isom = readMapFile(newMapFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: KUNGSHATT }), "ny.omap");
    const isomBoulder = [...isom.symbols.values()].find(entry => entry.code.main === 204) as PointSymbol;
    expect(isomBoulder.elements).toMatchObject([{ kind: "dot", diameter: 0.4 }]);
    const sprint4k = readMapFile(newMapFile({ symbolSet: "ISSPROM2019-2", scale: 4000, refPoint: KUNGSHATT }), "ny.omap");
    const sprintBoulder = [...sprint4k.symbols.values()].find(entry => entry.code.main === 204) as PointSymbol;
    expect(sprintBoulder.elements).toMatchObject([{ kind: "dot", diameter: 0.6 }]);
    const sprint3k = readMapFile(newMapFile({ symbolSet: "ISSPROM2019-2", scale: 3000, refPoint: KUNGSHATT }), "ny.omap");
    const sprintBoulder3k = [...sprint3k.symbols.values()].find(entry => entry.code.main === 204) as PointSymbol;
    expect(sprintBoulder3k.elements).toMatchObject([{ kind: "dot", diameter: 0.8 }]);
  });

  it("färgtabeller: separata greenPoint/blueArea, IOF-ordning för byggnad/skärmtak/512.3 och olivgrön CMYK 38/27/100/0", () => {
    const isom = readMapFile(newMapFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: KUNGSHATT }), "skog.omap");
    const sprint = readMapFile(newMapFile({ symbolSet: "ISSPROM2019-2", scale: 4000, refPoint: KUNGSHATT }), "sprint.omap");
    const rankOf = (map: typeof isom, name: string) => map.colors.find(color => color.name === name)!.rank;
    const byCode = (map: typeof isom, code: string) => [...map.symbols.values()].find(symbol => symbol.code.text === code)!;

    // Olivgrön CMYK 38/27/100/0 i båda mallarna.
    for (const map of [isom, sprint]) {
      const olive = map.colors.find(color => color.name === "Olivgrön")!;
      expect(olive.cmyk).toEqual({ c: 0.38, m: 0.27, y: 1, k: 0 });
      // greenPoint (417–419) separat från green (ytor), och högre än kurvor/hårdgjord yta/skärmtak/olivgrönt.
      expect(rankOf(map, "Grön 100 % (punkt)")).toBeLessThan(rankOf(map, "Brun"));
      expect(rankOf(map, "Grön 100 % (punkt)")).toBeLessThan(rankOf(map, "Svart 20 %"));
      expect(rankOf(map, "Grön 100 % (punkt)")).toBeLessThan(rankOf(map, "Brun 50 %"));
      expect(rankOf(map, "Grön 100 % (punkt)")).toBeLessThan(rankOf(map, "Grön"));
      // blueArea (kärr 307/308/310) separat från blue (bäckar), och under kurvor/skärmtak/hårdgjord yta.
      expect(rankOf(map, "Blå")).toBeLessThan(rankOf(map, "Brun"));
      expect(rankOf(map, "Blå (yta)")).toBeGreaterThan(rankOf(map, "Brun"));
      expect(rankOf(map, "Blå (yta)")).toBeGreaterThan(rankOf(map, "Brun 50 %"));
      expect(rankOf(map, "Blå (yta)")).toBeGreaterThan(rankOf(map, "Svart 20 %"));
      // 417–419 använder greenPoint, inte green; 308 använder blueArea, inte blue.
      const greenPtId = map.colors.find(c => c.name === "Grön 100 % (punkt)")!.id;
      const blueAreaId = map.colors.find(c => c.name === "Blå (yta)")!.id;
      const s419 = byCode(map, "419") as PointSymbol;
      expect(s419.elements.every(el => el.color === greenPtId)).toBe(true);
      const s308 = byCode(map, "308") as AreaSymbol;
      expect(s308.hatches[0]!.color).toBe(blueAreaId);
    }

    // ISOM: skärmtak (Svart 20 %) ovanför hårdgjord yta (Brun 50 %).
    expect(rankOf(isom, "Svart 20 %")).toBeLessThan(rankOf(isom, "Brun 50 %"));

    // ISSprOM: 512.3 Vit (lägre nivå) > 521 Svart 50 % > 522 Svart 20 % > Brun (kurvor) > Brun 50 % > Brun 30 % > Svart 35 % > Blå 70 %.
    expect(rankOf(sprint, "Svart")).toBeLessThan(rankOf(sprint, "Vit (lägre nivå)"));
    expect(rankOf(sprint, "Vit (lägre nivå)")).toBeLessThan(rankOf(sprint, "Svart 50 %"));
    expect(rankOf(sprint, "Svart 50 %")).toBeLessThan(rankOf(sprint, "Svart 20 %"));
    expect(rankOf(sprint, "Svart 20 %")).toBeLessThan(rankOf(sprint, "Brun"));
    expect(rankOf(sprint, "Brun")).toBeLessThan(rankOf(sprint, "Brun 50 %"));
    expect(rankOf(sprint, "Brun 50 %")).toBeLessThan(rankOf(sprint, "Brun 30 %"));
    expect(rankOf(sprint, "Brun 30 %")).toBeLessThan(rankOf(sprint, "Svart 35 %"));
    expect(rankOf(sprint, "Svart 35 %")).toBeLessThan(rankOf(sprint, "Blå 70 %"));
    const s512_3 = byCode(sprint, "512.3") as AreaSymbol;
    expect(sprint.colors.find(c => c.id === s512_3.fill)!.name).toBe("Vit (lägre nivå)");
  });

  it("ring()-formel, 507 dubbelstreck + half_outer_dashes, 511/512/512.1 kantlinjer/vingar/stolpar och rättade normsymboler", () => {
    const isomBytes = newMapFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: KUNGSHATT });
    const sprintBytes = newMapFile({ symbolSet: "ISSPROM2019-2", scale: 4000, refPoint: KUNGSHATT });
    const isomXml = new TextDecoder().decode(isomBytes);
    const sprintXml = new TextDecoder().decode(sprintBytes);
    const isom = readMapFile(isomBytes, "skog.omap");
    const sprint = readMapFile(sprintBytes, "sprint.omap");
    const byCode = (map: typeof isom, code: string) => [...map.symbols.values()].find(symbol => symbol.code.text === code)!;

    // 1. ring()-formeln: inner_radius = diameter / 2 - width -> mittlinjediameter = diameter - width (ytterdiameter = diameter).
    const s311 = byCode(isom, "311") as PointSymbol;
    expect(s311.elements).toMatchObject([{ kind: "circle", diameter: 0.72, lineWidth: 0.18 }]);
    const s417 = byCode(isom, "417") as PointSymbol;
    expect(s417.elements).toMatchObject([{ kind: "dot", diameter: 0.56 }, { kind: "circle", diameter: 0.72, lineWidth: 0.18 }]);
    const s418 = byCode(isom, "418") as PointSymbol;
    expect(s418.elements).toMatchObject([{ kind: "dot", diameter: 0.2 }, { kind: "circle", diameter: 0.33, lineWidth: 0.17 }]);
    const s526 = byCode(isom, "526") as PointSymbol;
    expect(s526.elements).toMatchObject([{ kind: "circle", diameter: 0.62, lineWidth: 0.18 }, { kind: "dot", diameter: 0.2 }]);
    const s545 = byCode(sprint, "545") as PointSymbol;
    expect(s545.elements).toMatchObject([{ kind: "dot", diameter: 0.4 }, { kind: "circle", diameter: 0.8, lineWidth: 0.1 }]);
    const logo = byCode(isom, "991") as PointSymbol;
    expect(logo.elements[0]).toMatchObject({ kind: "circle", diameter: 7.8, lineWidth: 1 });

    // 2. 507 dubbelstreck (dashes_in_group="2") och half_outer_dashes="true" på streckade linjer.
    expect(isomXml).toContain('code="507"');
    expect(isomXml).toContain('dashes_in_group="2" in_group_break_length="250"');
    const s507 = byCode(isom, "507") as LineSymbol;
    expect(s507.strokes[0]!.dash).toEqual([1, 0.25, 1, 0.75]);
    expect(s507.strokes[0]!.dashSpec).toEqual({ mainLength: 2.25, mainGap: 0.75, endLength: 1.125, secondaryGap: 0.25 });
    const s507Sprint = byCode(sprint, "507") as LineSymbol;
    expect(s507Sprint.strokes[0]!.dash).toEqual([1.5, 0.375, 1.5, 1.125]);
    // Vanliga streckade linjer (t.ex. 103, 505) har half_outer_dashes="true" (endLength = mainLength / 2).
    const s103 = byCode(isom, "103") as LineSymbol;
    expect(s103.strokes[0]!.dashSpec).toEqual({ mainLength: 2.25, mainGap: 0.25, endLength: 1.125 });

    // 3. 510/511/512/512.1: separerade kantlinjer (aldrig sammansmält svart stapel) + stolpar + brovingar.
    const s510 = byCode(isom, "510") as LineSymbol;
    expect(s510.corner?.elements).toHaveLength(1);
    const s511 = byCode(isom, "511") as LineSymbol;
    expect(s511.strokes).toHaveLength(2);
    expect(s511.strokes.map(s => s.offset)).toEqual([0.25, -0.25]);
    expect(s511.corner?.elements).toHaveLength(1);
    const s512 = byCode(isom, "512") as LineSymbol;
    expect(s512.strokes).toHaveLength(2);
    expect(s512.strokes.map(s => s.offset)).toEqual([0.25, -0.25]);
    expect(s512.start?.elements).toHaveLength(2);
    expect(s512.end?.elements).toHaveLength(2);
    const s512_1 = byCode(sprint, "512.1") as LineSymbol;
    expect(s512_1.strokes).toHaveLength(2);
    expect(s512_1.strokes[0]!.offset).toBeCloseTo(0.35, 6);
    expect(s512_1.strokes[1]!.offset).toBeCloseTo(-0.35, 6);
    expect(s512_1.start?.elements).toHaveLength(2);
    expect(s512_1.end?.elements).toHaveLength(2);

    // 4. Rättade normsymboler: 105 ≠ 107, 106/514/517 streck+mitt, 303 V, 307 svart kant, 310 streckad, 509 svart-vit,
    //    ISSprOM 515/518/529 åtskilda, 516 sneda streck, 518 dubbla streck, 524/525 T, 527 foderhäck, rotatable-flaggor.
    const s105 = byCode(isom, "105") as LineSymbol;
    expect(s105.strokes[0]!.width).toBeCloseTo(0.18, 6);
    expect(s105.repeated?.elements).toMatchObject([{ kind: "dot", diameter: 0.45 }]);
    const s106 = byCode(isom, "106") as LineSymbol;
    expect(s106.strokes[0]!.dashSpec).toEqual({ mainLength: 1.7, mainGap: 0.25, endLength: 1.7 });
    expect(s106.repeated?.spacing).toBeCloseTo(1.95, 6);
    expect(s106.repeated?.endLength).toBeCloseTo(0.85, 6);
    const s303 = byCode(isom, "303") as PointSymbol;
    expect(s303.elements).toMatchObject([{ kind: "line", width: 0.18 }]);
    const s307 = byCode(isom, "307");
    expect(s307.kind).toBe("COMBINED");
    const s310 = byCode(isom, "310") as AreaSymbol;
    expect(s310.hatches).toEqual([]);
    expect(s310.pattern?.elements).toHaveLength(2);
    const s509 = byCode(isom, "509") as LineSymbol;
    const whiteRailId = isom.colors.find(c => c.name === "Vit (järnväg)")!.id;
    expect(s509.strokes[0]).toMatchObject({ color: whiteRailId, width: 0.25 });
    expect(s509.strokes).toHaveLength(3);
    const s514 = byCode(isom, "514") as LineSymbol;
    expect(s514.repeated?.spacing).toBeCloseTo(1.95, 6);
    const s516 = byCode(isom, "516") as LineSymbol;
    expect(s516.repeated?.elements[0]).toMatchObject({ kind: "line", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 0.35, y: -0.35 }] });
    const s518Isom = byCode(isom, "518") as LineSymbol;
    expect(s518Isom.repeated?.count).toBe(2);
    const s515Sp = byCode(sprint, "515") as LineSymbol;
    const s518Sp = byCode(sprint, "518") as LineSymbol;
    const s529Sp = byCode(sprint, "529") as LineSymbol;
    expect(s515Sp.repeated?.elements).toMatchObject([{ kind: "dot", diameter: 0.8 }]);
    expect(s518Sp.repeated?.count).toBe(2);
    expect(s529Sp.repeated?.elements).toMatchObject([{ kind: "line", width: 0.2 }]);
    const s524 = byCode(isom, "524") as PointSymbol;
    expect(s524.elements).toHaveLength(2);
    expect(s524.elements.every(el => el.kind === "line")).toBe(true);
    const s525 = byCode(isom, "525") as PointSymbol;
    expect(s525.elements).toHaveLength(2);
    expect(s525.elements.every(el => el.kind === "line")).toBe(true);
    const s527 = byCode(isom, "527") as PointSymbol;
    expect(s527.elements).toHaveLength(3);
    // Textsymboler har rotatable="true", 111/112/207/527 är nordorienterade, 522.1/542 är vridbara.
    expect(isomXml).toContain('<text_symbol icon_text="A" rotatable="true">');
    for (const code of ["111", "112", "207", "527"]) {
      expect(isomXml).toMatch(new RegExp(`code="${code}"[^>]*><point_symbol rotatable="false"`));
    }
    for (const code of ["522.1", "542"]) {
      expect(sprintXml).toMatch(new RegExp(`code="${code}"[^>]*><point_symbol rotatable="true"`));
    }
  });

  it("sprintmallen har opasserbar vegetation (411) som mörkgrön yta och som häcklinje i minsta bredd 0,4 mm", () => {
    const map = readMapFile(newMapFile({ symbolSet: "ISSPROM2019-2", scale: 4000, refPoint: KUNGSHATT }), "ny.omap");
    const symbols = [...map.symbols.values()].filter(symbol => symbol.code.main === 411);
    expect(symbols.map(symbol => `${symbol.code.text} ${symbol.kind}`).sort()).toEqual(["411 AREA", "411.1 LINE"]);
    const cmyk = (index: number | undefined) => { const color = map.colors.find(entry => entry.id === index)!.cmyk; return [color.c, color.m, color.y, color.k]; };
    const rank = (id: number | undefined) => map.colors.find(entry => entry.id === id)!.rank;
    const area = symbols.find(symbol => symbol.kind === "AREA") as AreaSymbol, line = symbols.find(symbol => symbol.kind === "LINE") as LineSymbol;
    expect(cmyk(area.fill)).toEqual([1, 0, 0.8, 0.3]);
    expect(area.hatches).toEqual([]);
    expect(line.strokes[0]!.width).toBeCloseTo(0.4, 6);
    expect(cmyk(line.strokes[0]!.color)).toEqual([1, 0, 0.8, 0.3]);
    // Linjen ligger över tomtmarkens olivgröna och ytan under den (normens färgordning; lägre rang ritas överst).
    const olive = (map.symbols.get([...map.symbols.values()].find(symbol => symbol.code.main === 520)!.id) as AreaSymbol).fill!;
    expect(rank(line.strokes[0]!.color)).toBeLessThan(rank(olive));
    expect(rank(area.fill)).toBeGreaterThan(rank(olive));
    // Skogsmallen har kvar sin 411 (grön med svart raster) och inga nya färger.
    expect(SYMBOL_SETS["ISOM2017-2"].colors.some(color => color.key.startsWith("darkgreen"))).toBe(false);
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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMapRevisionWithSymbols, applyMapSymbolReplacements, newMapFile, readMapFile, sha256Hex, SYMBOL_SETS, withSymbolReplacements, type MapSymbol, type ParsedMap } from "../src";

const KUNGSHATT = { easting: 660_000, northing: 6_575_000 };
const SPRINT = SYMBOL_SETS["ISSPROM2019-2"];
const def = (code: string) => SPRINT.symbols.find(symbol => symbol.code === code)!;
const byCode = (map: Pick<ParsedMap, "symbols">, code: string) => [...map.symbols.values()].find(symbol => symbol.code.text === code)!;
const colorName = (map: Pick<ParsedMap, "colors">, id: number | undefined) => map.colors.find(color => color.id === id)?.name;
const byName = (map: Pick<ParsedMap, "colors">, name: string) => map.colors.find(color => color.name === name)?.id;
const partsOf = (map: Pick<ParsedMap, "symbols">, symbol: MapSymbol) => symbol.kind === "COMBINED" ? symbol.parts.map(id => map.symbols.get(id)!) : [];

describe("normens symboler i en Mapper-karta", () => {
  // En skogskarta ur O-Tids ISOM-mall: helsvart byggnad, ingen svart 50 %.
  const bytes = newMapFile({ symbolSet: "ISOM2017-2", scale: 10000, refPoint: KUNGSHATT });
  const before = readMapFile(bytes, "skog.omap");

  it("byter byggnaden mot grå med kant, lägger in svart 50 % ovanför svart 65 % och flyttar de andra symbolernas färger", () => {
    const result = applyMapSymbolReplacements(bytes, [{ code: "521", def: def("521"), palette: SPRINT.colors }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(1);
    const after = readMapFile(result.bytes, "skog.omap");
    expect(after.colors).toHaveLength(before.colors.length + 1);
    const names = after.colors.map(color => color.name);
    expect(names.indexOf("Svart 50 %")).toBe(names.indexOf("Svart 65 %") - 1);
    const building = byCode(after, "521");
    expect(building.kind).toBe("COMBINED");
    expect(building.id).toBe(byCode(before, "521").id);
    const [area, line] = partsOf(after, building);
    expect(area?.kind === "AREA" && colorName(after, area.fill)).toBe("Svart 50 %");
    expect(line?.kind === "LINE" && colorName(after, line.strokes[0]?.color)).toBe("Svart");
    // Kal berghäll (svart 20 %) pekar fortfarande på sin färg fast prioriteten flyttats.
    const rock = byCode(after, "214");
    expect(rock.kind === "AREA" && colorName(after, rock.fill)).toBe("Svart 20 %");
    expect(after.objects).toHaveLength(before.objects.length);
  });

  it("modellen ger samma symbol och färgordning som filen", () => {
    const model = withSymbolReplacements(before, [{ code: "521", def: def("521"), palette: SPRINT.colors }, { code: "214", def: def("214"), palette: SPRINT.colors }]);
    const written = applyMapSymbolReplacements(bytes, [{ code: "521", def: def("521"), palette: SPRINT.colors }, { code: "214", def: def("214"), palette: SPRINT.colors }]);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const file = readMapFile(written.bytes, "skog.omap");
    const order = (map: Pick<ParsedMap, "colors">) => [...map.colors].sort((a, b) => a.rank - b.rank).map(color => color.name);
    expect(order(model)).toEqual(order(file));
    const rock = byCode(model, "214");
    expect(rock.kind === "AREA" && colorName(model, rock.fill)).toBe("Svart 35 %");
    const [area] = partsOf(model, byCode(model, "521"));
    expect(area?.kind === "AREA" && colorName(model, area.fill)).toBe("Svart 50 %");
  });

  it("trappan blir steg över ett brunt band med kantlinjer; en symbol som inte finns eller en OCAD-fil ändrar inget", () => {
    const result = applyMapSymbolReplacements(bytes, [{ code: "532", def: def("532"), palette: SPRINT.colors }, { code: "777", def: def("521"), palette: SPRINT.colors }]);
    expect(result.ok && result.changed).toBe(1);
    if (!result.ok) return;
    const stair = byCode(readMapFile(result.bytes, "skog.omap"), "532");
    const model = readMapFile(result.bytes, "skog.omap");
    expect(stair.kind === "LINE" && stair.strokes.map(stroke => [colorName(model, stroke.color), stroke.width, stroke.offset])).toEqual([
      ["Brun 30 % (trappa)", 0.4, undefined], ["Svart", 0.1, 0.25], ["Svart", 0.1, -0.25]]);
    expect(applyMapSymbolReplacements(new Uint8Array([0xad, 0x0c, 0, 0]), [{ code: "521", def: def("521"), palette: SPRINT.colors }]).ok).toBe(false);
  });

  it("trappans band får en egen brun 30 % ovanför alla ytfärger och under svart (ägaren 2026-11-23), också när kartan har brunt 30 %", () => {
    // Först 501.3 (lägger in den vanliga bruna 30 % under brunt 50 %), sedan trappan.
    const first = applyMapSymbolReplacements(bytes, [{ code: "501", def: { ...def("501.3"), code: "501" }, palette: SPRINT.colors }]);
    if (!first.ok) throw new Error(first.message);
    const result = applyMapSymbolReplacements(first.bytes, [{ code: "532", def: def("532"), palette: SPRINT.colors }]);
    if (!result.ok) throw new Error(result.message);
    const model = readMapFile(result.bytes, "skog.omap");
    const stair = byCode(model, "532");
    const band = stair.kind === "LINE" ? model.colors.find(color => color.id === stair.strokes[0]?.color) : undefined;
    expect(band?.name).toBe("Brun 30 % (trappa)");
    const rankOf = (name: string) => model.colors.find(color => color.name === name)!.rank;
    expect(rankOf("Brun 30 %")).toBeGreaterThan(band!.rank);
    expect(rankOf("Svart")).toBeLessThan(band!.rank);
    // Alla ytsymbolers fyllning ritas under bandet, utom de helsvarta (206 Jättesten) som ligger med de svarta linjerna.
    for (const symbol of model.symbols.values()) if (symbol.kind === "AREA" && symbol.fill !== undefined && symbol.fill !== byName(model, "Svart")) {
      expect(model.colors.find(color => color.id === symbol.fill)!.rank, symbol.code.text).toBeGreaterThan(band!.rank);
    }
  });

  it("O-Tids sprintmall: trappans färg direkt under de bruna linjerna, ovanför brunt 50 %, husen, olivgrönt, grönt och gult", () => {
    const names = SPRINT.colors.map(color => color.name);
    const at = names.indexOf("Brun 30 % (trappa)");
    expect(at).toBe(names.indexOf("Brun") + 1);
    for (const below of ["Brun 50 %", "Brun 30 %", "Svart 50 %", "Svart 20 %", "Olivgrön", "Mörkgrön", "Grön", "Gul", "Gul 50 %"]) expect(names.indexOf(below), below).toBeGreaterThan(at);
    expect(names.indexOf("Svart")).toBeLessThan(at);
  });

  it("lägger till en symbol som saknas (nytt id sist), aldrig en som finns", () => {
    const result = applyMapSymbolReplacements(bytes, [{ code: "545", def: def("545"), palette: SPRINT.colors, add: true },
      { code: "521", def: def("521"), palette: SPRINT.colors, add: true }]);
    expect(result.ok && result.changed).toBe(1);
    if (!result.ok) return;
    const after = readMapFile(result.bytes, "skog.omap");
    expect(after.symbols.size).toBe(before.symbols.size + 1);
    const lamp = byCode(after, "545");
    expect(lamp.name).toBe("Lyktstolpe");
    expect(Number(lamp.id)).toBeGreaterThan(Math.max(...[...before.symbols.keys()].filter(id => /^\d+$/.test(id)).map(Number)));
    expect(byCode(after, "521").kind).toBe("AREA");
    const model = withSymbolReplacements(before, [{ code: "545", def: def("545"), palette: SPRINT.colors, add: true }]);
    expect(byCode(model, "545").id).toBe(lamp.id);
  });

  it("fungerar på officiell Mapper-karta med 100 % spotfärger: byter normsymbol, lägger till ny färg, flyttar spotcolor-referenser och lägger till ny normsymbol", () => {
    const spotOmap = `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="4000"/>
<colors count="4">
<color priority="0" name="Svart" c="0" m="0" y="0" k="1" opacity="1"><spotcolors><namedcolor>BLACK</namedcolor></spotcolors><cmyk method="custom"/><rgb method="cmyk" r="0" g="0" b="0"/></color>
<color priority="1" name="Svart 65 %" c="0" m="0" y="0" k="0.65" opacity="1"><spotcolors knockout="true"><component factor="0.65" spotcolor="0"/></spotcolors><cmyk method="spotcolor"/><rgb method="cmyk" r="0.35" g="0.35" b="0.35"/></color>
<color priority="2" name="Brun" c="0" m="0.56" y="1" k="0.18" opacity="1"><spotcolors><namedcolor>BROWN</namedcolor></spotcolors><cmyk method="custom"/><rgb method="cmyk" r="0.82" g="0.36" b="0"/></color>
<color priority="3" name="Brun 50 %" c="0" m="0.28" y="0.5" k="0.09" opacity="1"><spotcolors knockout="true"><component factor="0.5" spotcolor="2"/></spotcolors><cmyk method="spotcolor"/><rgb method="cmyk" r="0.91" g="0.68" b="0.45"/></color>
</colors>
<barrier version="6" required="0.6.0">
<symbols count="2">
<symbol type="4" id="0" code="521" name="Byggnad"><area_symbol inner_color="0" min_area="0" patterns="0"/></symbol>
<symbol type="2" id="1" code="101" name="Kurva"><line_symbol color="2" line_width="140"/></symbol>
</symbols>
<parts count="1" current="0"><part name="del"><objects count="1">
<object type="1" symbol="1"><coords count="2">0 0;1000 0;</coords></object>
</objects></part></parts>
</barrier>
</map>`;
    const spotBytes = new TextEncoder().encode(spotOmap);
    const spotBefore = readMapFile(spotBytes, "spot.omap");
    expect(spotBefore.colors.every(color => !!color.spot)).toBe(true);

    // 1. Lägg till normsymbol 545 (använder bara svart, som redan finns som spotfärg -> ingen ny färg behövs!)
    const withLamp = applyMapRevisionWithSymbols(spotBytes, { baseFileSha256: sha256Hex(spotBytes), format: "OMAP", changes: [] }, [],
      [{ code: "545", def: def("545"), palette: SPRINT.colors, add: true }]);
    if (!withLamp.ok) throw new Error(JSON.stringify(withLamp.refusals));
    const afterLamp = readMapFile(withLamp.bytes, "spot.omap");
    expect(afterLamp.colors).toEqual(spotBefore.colors);
    const lamp = byCode(afterLamp, "545");
    expect(lamp.kind === "POINT" && lamp.elements.every(el => el.color === 0)).toBe(true);

    // 2. Byt ut 521 (kräver Svart 50 %, som läggs in ovanför Svart 65 % och skiftar Brun 2->3 och Brun 50 % spotcolor="2"->"3"!)
    const replaced = applyMapSymbolReplacements(withLamp.bytes, [{ code: "521", def: def("521"), palette: SPRINT.colors }]);
    if (!replaced.ok) throw new Error(replaced.message);
    const xml = new TextDecoder().decode(replaced.bytes);
    expect(xml).toContain("<spotcolors><namedcolor>BLACK</namedcolor></spotcolors>");
    expect(xml).toContain('<spotcolors knockout="true"><component factor="0.65" spotcolor="0"/></spotcolors>');
    expect(xml).toContain("<spotcolors><namedcolor>BROWN</namedcolor></spotcolors>");
    expect(xml).toContain('<spotcolors knockout="true"><component factor="0.5" spotcolor="3"/></spotcolors>');

    const after = readMapFile(replaced.bytes, "spot.omap");
    expect(after.colors.map(color => color.name)).toEqual(["Svart", "Svart 50 %", "Svart 65 %", "Brun", "Brun 50 %"]);
    expect(after.colors[0]!.spot).toEqual(spotBefore.colors[0]!.spot);
    expect(after.colors[2]!.spot).toEqual(spotBefore.colors[1]!.spot);
    expect(after.colors[3]!.spot).toEqual(spotBefore.colors[2]!.spot);
    expect(after.colors[4]!.spot).toEqual(spotBefore.colors[3]!.spot);
    // Kurvan (101) ska fortfarande ha Brun (nu priority 3).
    const contour = byCode(after, "101");
    expect(contour.kind === "LINE" && colorName(after, contour.strokes[0]?.color)).toBe("Brun");
    // Byggnaden (521) har nu Svart 50 % fyllning + Svart kant.
    const [area, line] = partsOf(after, byCode(after, "521"));
    expect(area?.kind === "AREA" && colorName(after, area.fill)).toBe("Svart 50 %");
    expect(line?.kind === "LINE" && colorName(after, line.strokes[0]?.color)).toBe("Svart");
  });

  it("OCAD Steg 2: lägger till och byter normsymboler i en riktig OCAD-fil med rundtur", () => {
    const ocdBytes = new Uint8Array(readFileSync(join(import.meta.dirname, "../../../fixtures/maps/kartfil.ocd")));
    const ocdBefore = readMapFile(ocdBytes, "kartfil.ocd", { sources: true });
    // Byt befintlig symbol 406.0 (matchar via "406") och lägg till saknad normsymbol 545 (Lyktstolpe).
    const replaced = applyMapSymbolReplacements(ocdBytes, [
      { code: "406", def: def("406"), palette: SPRINT.colors },
      { code: "545", def: def("545"), palette: SPRINT.colors, add: true }
    ]);
    if (!replaced.ok) throw new Error(replaced.message);
    const ocdAfter = readMapFile(replaced.bytes, "kartfil.ocd");
    expect([...ocdAfter.symbols.values()].some(symbol => symbol.code.main === 545)).toBe(true);
    expect(ocdAfter.objects).toHaveLength(ocdBefore.objects.length);

    // applyMapRevisionWithSymbols: kräver ocad: true och låter ett nytt objekt använda den tillagda normsymbolen.
    const lampModel = withSymbolReplacements(ocdBefore, [{ code: "545", def: def("545"), palette: SPRINT.colors, add: true }]);
    const lampInMemory = [...lampModel.symbols.values()].find(symbol => symbol.code.main === 545)!;
    const changeSet = {
      baseFileSha256: sha256Hex(ocdBytes),
      format: "OCD" as const,
      changes: [{ kind: "add" as const, id: "ny-lykta", author: "a", at: "2026-11-26T16:00:00Z", symbol: lampInMemory.id,
        geometry: { kind: "point" as const, at: { x: 10, y: 20 } }, angle: 0 }]
    };
    expect(applyMapRevisionWithSymbols(ocdBytes, changeSet, [], [{ code: "545", def: def("545"), palette: SPRINT.colors, add: true }], { ocad: false }))
      .toMatchObject({ ok: false, refusals: [{ code: "UNSUPPORTED_VERSION" }] });
    const rev = applyMapRevisionWithSymbols(ocdBytes, changeSet, [], [{ code: "545", def: def("545"), palette: SPRINT.colors, add: true }], { ocad: true });
    if (!rev.ok) throw new Error(JSON.stringify(rev.refusals));
    const revMap = readMapFile(rev.bytes, "kartfil.ocd");
    expect(revMap.objects).toHaveLength(ocdBefore.objects.length + 1);
    const addedLamp = revMap.objects.find(object => object.kind === "point" && Math.abs(object.at.x - 10) < 0.02 && Math.abs(object.at.y - 20) < 0.02);
    expect(addedLamp && revMap.symbols.get(addedLamp.symbol)?.code.main).toBe(545);
  });
});

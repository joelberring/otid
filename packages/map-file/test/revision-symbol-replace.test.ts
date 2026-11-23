import { describe, expect, it } from "vitest";
import { applyMapSymbolReplacements, newMapFile, readMapFile, SYMBOL_SETS, withSymbolReplacements, type MapSymbol, type ParsedMap } from "../src";

const KUNGSHATT = { easting: 660_000, northing: 6_575_000 };
const SPRINT = SYMBOL_SETS["ISSPROM2019-2"];
const def = (code: string) => SPRINT.symbols.find(symbol => symbol.code === code)!;
const byCode = (map: Pick<ParsedMap, "symbols">, code: string) => [...map.symbols.values()].find(symbol => symbol.code.text === code)!;
const colorName = (map: Pick<ParsedMap, "colors">, id: number | undefined) => map.colors.find(color => color.id === id)?.name;
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

  it("trappan blir bara steg; en symbol som inte finns eller en OCAD-fil ändrar inget", () => {
    const result = applyMapSymbolReplacements(bytes, [{ code: "532", def: def("532"), palette: SPRINT.colors }, { code: "777", def: def("521"), palette: SPRINT.colors }]);
    expect(result.ok && result.changed).toBe(1);
    if (!result.ok) return;
    const stair = byCode(readMapFile(result.bytes, "skog.omap"), "532");
    expect(stair.kind === "LINE" && stair.strokes).toEqual([]);
    expect(applyMapSymbolReplacements(new Uint8Array([0xad, 0x0c, 0, 0]), [{ code: "521", def: def("521"), palette: SPRINT.colors }]).ok).toBe(false);
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
});

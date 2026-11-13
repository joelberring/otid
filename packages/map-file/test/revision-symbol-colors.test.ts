import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMapSymbolColors, effectiveSymbolColorChanges, readMapFile, symbolColorIds, withSymbolColorChanges, type MapSymbol } from "../src/index";

/** Ägaren 2026-11-13: en symbols färg byts mot en annan av kartans färger, per symbol och färgplats. */
const fixture = readFileSync(join(import.meta.dirname, "../../../fixtures/maps/kartfil.omap"), "utf8");
const extra = [
  // 521: yta med fyllning (brun, 3) och kant (brun och svart), som en byggnad i en äldre mall.
  `<symbol type="4" id="8" code="521" name="Byggnad"><area_symbol inner_color="3" min_area="0" patterns="1"><pattern type="1" angle="0" line_spacing="300" line_offset="0" offset_along_line="0" color="1" line_width="100"/></area_symbol></symbol>`,
  `<symbol type="2" id="9" code="521.1" name="Kant, byggnad"><line_symbol color="3" line_width="140" minimum_length="0" join_style="2" cap_style="1" start_offset="0" end_offset="0" segment_length="0" end_length="0" show_at_least_one_symbol="true" minimum_mid_symbol_count="0" minimum_mid_symbol_count_when_closed="0" dash_length="4000" break_length="1000" dashes_in_group="1" in_group_break_length="500" mid_symbols_per_spot="1" mid_symbol_distance="0"/></symbol>`,
  // 522: kombinerad symbol med privata delar (yta och linje i brunt) och ett inbyggt <symbol> i en mittsymbol.
  `<symbol type="16" id="10" code="522" name="Kombinerad"><combined_symbol parts="2"><part private="true"><symbol type="4" id="0"><area_symbol inner_color="3" min_area="0" patterns="0"/></symbol></part><part private="true"><symbol type="2" id="0"><line_symbol color="3" line_width="140" minimum_length="0" join_style="2" cap_style="1" start_offset="0" end_offset="0" segment_length="0" end_length="0" show_at_least_one_symbol="true" minimum_mid_symbol_count="0" minimum_mid_symbol_count_when_closed="0" dash_length="4000" break_length="1000" dashes_in_group="1" in_group_break_length="500" mid_symbols_per_spot="1" mid_symbol_distance="0"/></symbol></part></combined_symbol></symbol>`
].join("\n");
const text = fixture.replace("</symbols>", `${extra}\n</symbols>`);
const bytes = new TextEncoder().encode(text);
const map = readMapFile(bytes, "kartfil.omap");
const black = map.colors.find(color => color.name === "Svart")!.id;
const brown = map.colors.find(color => color.name === "Brun")!.id;
const blue = map.colors.find(color => color.name === "Blå")!.id;
const byCode = (symbols: ReadonlyMap<string, MapSymbol>, code: string) => [...symbols.values()].find(symbol => symbol.code.text === code)!;

describe("symbolens färger", () => {
  it("räknar upp färgerna en symbol ritas med, också i privata delar", () => {
    expect(symbolColorIds(map.symbols, byCode(map.symbols, "521"))).toEqual([brown, black]);
    expect(symbolColorIds(map.symbols, byCode(map.symbols, "521.1"))).toEqual([brown]);
    expect(symbolColorIds(map.symbols, byCode(map.symbols, "522"))).toEqual([brown]);
  });

  it("byter en färgplats i en symbol med fyllning och kant och lämnar andra symboler med samma färg", () => {
    const next = withSymbolColorChanges(map.symbols, map.colors, [{ symbol: "521", from: brown, to: black }]);
    const building = byCode(next, "521");
    expect(building.kind === "AREA" && building.fill).toBe(black);
    expect(building.kind === "AREA" && building.hatches[0]!.color).toBe(black);
    expect(byCode(next, "521.1")).toEqual(byCode(map.symbols, "521.1"));
    expect(byCode(next, "406.0")).toEqual(byCode(map.symbols, "406.0"));
  });

  it("byter flera symboler på en gång, också de privata delarna i en kombinerad symbol", () => {
    const next = withSymbolColorChanges(map.symbols, map.colors, [{ symbol: "521", from: brown, to: blue }, { symbol: "521.1", from: brown, to: black },
      { symbol: "522", from: brown, to: black }]);
    expect(symbolColorIds(next, byCode(next, "521"))).toEqual([blue, black]);
    expect(symbolColorIds(next, byCode(next, "521.1"))).toEqual([black]);
    expect(symbolColorIds(next, byCode(next, "522"))).toEqual([black]);
  });

  it("hoppar över okända symboler, färger symbolen inte har, färger som saknas i tabellen och ändringar som inte byter något", () => {
    const changes = [{ symbol: "999.9", from: brown, to: black }, { symbol: "521", from: blue, to: black }, { symbol: "521", from: brown, to: 4242 },
      { symbol: "521.1", from: brown, to: brown }, { symbol: "521.1", from: brown, to: black }, { symbol: "521.1", from: brown, to: blue }];
    // Den sista ändringen av samma färgplats gäller.
    expect(effectiveSymbolColorChanges(map.symbols, map.colors, changes)).toEqual([{ symbol: "521.1", from: brown, to: blue }]);
    expect([...withSymbolColorChanges(map.symbols, map.colors, changes.slice(0, 4))]).toEqual([...map.symbols]);
  });
});

describe("symbolernas färger i Mapper-filen", () => {
  it("skriver färgbytet i symbolens element och lämnar resten av filen", () => {
    const result = applyMapSymbolColors(bytes, [{ symbol: "521", from: brown, to: black }, { symbol: "522", from: brown, to: blue }]);
    if (!result.ok) throw new Error(result.message);
    expect(result.changed).toBe(2);
    const after = readMapFile(result.bytes, "kartfil.omap");
    expect([...after.symbols]).toEqual([...withSymbolColorChanges(map.symbols, map.colors, [{ symbol: "521", from: brown, to: black }, { symbol: "522", from: brown, to: blue }])]);
    expect(after.colors).toEqual(map.colors);
    expect(after.objects).toEqual(map.objects);
    const lines = (data: Uint8Array) => new TextDecoder().decode(data).split("\n");
    expect(lines(result.bytes).filter((line, index) => line !== lines(bytes)[index])).toHaveLength(2);
  });

  it("inga verksamma ändringar ger samma bytes, och en OCAD-fil vägras", () => {
    expect(applyMapSymbolColors(bytes, [])).toEqual({ ok: true, bytes, changed: 0 });
    expect(applyMapSymbolColors(bytes, [{ symbol: "521", from: blue, to: black }])).toEqual({ ok: true, bytes, changed: 0 });
    const ocad = new Uint8Array(readFileSync(join(import.meta.dirname, "../../../fixtures/maps/kartfil.ocd")));
    expect(applyMapSymbolColors(ocad, [{ symbol: "521", from: brown, to: black }]).ok).toBe(false);
  });
});

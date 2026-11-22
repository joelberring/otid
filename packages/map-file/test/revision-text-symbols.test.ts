import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyMapRevisionWithTextSymbols, applyMapTextSymbols, effectiveTextSymbolChanges, nextTextSymbolCode, nextTextSymbolId, objectRefOf, readMapFile,
  sha256Hex, withTextSymbolChanges, type MapObject, type MapRevisionChange, type MapTextSymbolChange, type TextSymbol
} from "../src";
import { drawMap } from "../src/render";
import { fakeContext } from "./fake-canvas";

/** K8b V6: textsymbolernas stil och nya textsymboler skrivs tillbaka i Mapper-filen; textobjekt med radbrytning, vinkel och justering. */
const encoder = new TextEncoder(), decoder = new TextDecoder();
const meta = { author: "konto-1", at: "2026-11-22T20:00:00Z" } as const;
const OMAP = `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="10000"><ref_point x="0" y="0"/></georeferencing>
<colors count="3">
<color priority="0" name="Svart" c="0" m="0" y="0" k="1" opacity="1"><cmyk method="custom"/><rgb method="cmyk" r="0" g="0" b="0"/></color>
<color priority="1" name="Blå" c="1" m="0" y="0" k="0" opacity="1"><cmyk method="custom"/><rgb method="cmyk" r="0" g="0.6" b="1"/></color>
<color priority="2" name="Vit" c="0" m="0" y="0" k="0" opacity="1"><cmyk method="custom"/><rgb method="cmyk" r="1" g="1" b="1"/></color>
</colors>
<barrier version="6" required="0.6.0">
<symbols count="3" id="test">
<symbol type="2" id="0" code="101" name="Höjdkurva"><line_symbol color="0" line_width="140"/></symbol>
<symbol type="8" id="1" code="999.0" name="Namn"><text_symbol icon_text="A"><font family="Arial" size="3000"/><text color="0" line_spacing="1" paragraph_spacing="0" character_spacing="0"/></text_symbol></symbol>
<symbol type="8" id="2" code="902" name="Rubrik"><text_symbol icon_text="A"><font family="Times New Roman" size="5000" bold="true"/><text color="0" line_spacing="1" paragraph_spacing="0" character_spacing="0"/><framing color="2" mode="1" line_half_width="250" shadow_x_offset="0" shadow_y_offset="0"/></text_symbol></symbol>
</symbols>
<parts count="1" current="0">
<part name="Karta"><objects count="3">
<object type="1" symbol="0"><coords count="2">0 0;1000 0;</coords></object>
<object type="4" symbol="1" h_align="1" v_align="2"><coords count="1">100 -200;</coords><text>Djurgårds&amp;brunn</text></object>
<object type="4" symbol="2" h_align="0" v_align="0"><coords count="1">5000 -5000;</coords><text>Rubrik</text></object>
</objects></part>
</parts>
<templates count="0" first_front_template="0"/>
</barrier>
</map>
`;
const bytes = encoder.encode(OMAP);
const sha = sha256Hex(bytes);
const map = readMapFile(bytes, "test.omap", { sources: true });
const text = (id: string) => map.symbols.get(id) as TextSymbol;
const style = (id: string, edit: Partial<MapTextSymbolChange> = {}): MapTextSymbolChange => {
  const symbol = text(id);
  return { id, fontFamily: symbol.fontFamily, size: symbol.size, color: symbol.color, bold: symbol.bold, italic: symbol.italic,
    framing: symbol.framing ?? null, ...edit };
};
function written(result: ReturnType<typeof applyMapTextSymbols>) {
  if (!result.ok) throw new Error(result.message);
  return { text: decoder.decode(result.bytes), map: readMapFile(result.bytes, "ny.omap"), changed: result.changed };
}

describe("textsymbolerna läses", () => {
  it("läser konturen (framing med linje) och lämnar den annars bort", () => {
    expect(text("2")).toMatchObject({ kind: "TEXT", fontFamily: "Times New Roman", size: 5, bold: true, framing: { color: 2, width: 0.5 } });
    expect(text("1").framing).toBeUndefined();
    expect(text("1").align).toBeUndefined();
  });

  it("nästa lediga nummer och id", () => {
    expect(nextTextSymbolCode("999.0", ["999.0", "999.1"])).toBe("999.2");
    expect(nextTextSymbolCode("902", ["902"])).toBe("902.1");
    expect(nextTextSymbolId(["0", "1", "2", "10.0"])).toBe("3");
  });
});

describe("textsymbolernas ändringar", () => {
  it("hoppar över okänt, fel slag, saknade färger, orimliga mått och det som inte ändrar något", () => {
    const changes = [style("1", { id: "0" }), style("1", { id: "9" }), style("1", { color: 42 }), style("1", { size: 0 }), style("1"),
      style("1", { framing: { color: 42, width: 0.3 } }), style("1", { copyOf: "1", id: "2", code: "999.1" })];
    expect(effectiveTextSymbolChanges(map.symbols, map.colors, changes)).toEqual([]);
    const last = effectiveTextSymbolChanges(map.symbols, map.colors, [style("1", { size: 4 }), style("1", { size: 5.0004 })]);
    expect(last).toEqual([style("1", { size: 5 })]);
  });

  it("ändrar alla texter med symbolen och lägger kopian sist", () => {
    const next = withTextSymbolChanges(map.symbols, map.colors, [style("1", { fontFamily: "Verdana", size: 4, color: 1, italic: true, align: "right",
      framing: { color: 2, width: 0.3 } }), style("1", { id: "3", copyOf: "1", code: "999.1", name: "Namn liten", size: 2 })]);
    expect(next.get("1")).toMatchObject({ fontFamily: "Verdana", size: 4, color: 1, italic: true, align: "right", framing: { color: 2, width: 0.3 } });
    expect([...next.keys()]).toEqual(["0", "1", "2", "3"]);
    expect(next.get("3")).toMatchObject({ kind: "TEXT", id: "3", code: { text: "999.1", main: 999, sub: 1 }, name: "Namn liten", size: 2, fontFamily: "Arial" });
  });
});

describe("textsymbolerna i Mapper-filen", () => {
  it("skriver typsnitt, storlek, färg, fet/kursiv och kontur i symbolen och läser tillbaka samma", () => {
    const changes = [style("1", { fontFamily: "Verdana", size: 4.2, color: 1, bold: true, italic: true, framing: { color: 2, width: 0.3 } }),
      style("2", { framing: null, bold: false })];
    const result = written(applyMapTextSymbols(bytes, changes));
    expect(result.changed).toBe(2);
    expect(result.text).toContain(`<font family="Verdana" size="4200" bold="true" italic="true"/><text color="1" line_spacing="1"`);
    expect(result.text).toContain(`<framing color="2" mode="1" line_half_width="150" shadow_x_offset="0" shadow_y_offset="0"/>`);
    expect(result.text).not.toContain(`line_half_width="250"`);
    expect([...result.map.symbols]).toEqual([...withTextSymbolChanges(map.symbols, map.colors, changes)]);
    expect(result.map.objects).toEqual(readMapFile(bytes, "test.omap").objects);
    // Bara symbolernas rader ändrades.
    const lines = (value: string) => value.split("\n");
    expect(lines(result.text).filter((line, index) => line !== lines(OMAP)[index])).toHaveLength(2);
  });

  it("en kopia får eget id, nummer och namn sist i tabellen och antalet räknas upp", () => {
    const result = written(applyMapTextSymbols(bytes, [style("2", { id: "3", copyOf: "2", code: "902.1", name: "Rubrik <liten>", size: 3 })]));
    expect(result.text).toContain(`<symbols count="4" id="test">`);
    expect(result.text).toMatch(/<symbol type="8" id="3" code="902.1" name="Rubrik &lt;liten&gt;"><text_symbol icon_text="A"><font family="Times New Roman" size="3000" bold="true"\/>/);
    expect(result.map.symbols.get("3")).toMatchObject({ kind: "TEXT", name: "Rubrik <liten>", size: 3, framing: { color: 2, width: 0.5 } });
    expect(result.map.symbols.get("2")).toEqual(text("2"));
  });

  it("en OCAD-fil vägras och inga ändringar ger samma bytes", () => {
    const ocad = new Uint8Array(readFileSync(join(import.meta.dirname, "../../../fixtures/maps/kartfil.ocd")));
    expect(applyMapTextSymbols(ocad, [style("1", { size: 4 })]).ok).toBe(false);
    expect(applyMapTextSymbols(bytes, [style("1")])).toMatchObject({ ok: true, bytes, changed: 0 });
    const set = { baseFileSha256: sha256Hex(ocad), format: "OCD" as const, changes: [] };
    expect(applyMapRevisionWithTextSymbols(ocad, set, [style("1", { size: 4 })], { ocad: true })).toMatchObject({ ok: false, refusals: [{ code: "UNSUPPORTED_VERSION" }] });
  });
});

describe("textobjekten med textsymbolerna (rundtur)", () => {
  const ref = (index: number) => objectRefOf(sha, map.objects[index]!)!;
  it("nya och ändrade texter med radbrytning, vinkel, ny symbol och justering läses tillbaka", () => {
    const copy = style("1", { id: "3", copyOf: "1", code: "999.1", name: "Namn 2", size: 2.5, align: "center" });
    const changes: MapRevisionChange[] = [
      { kind: "add", id: "ny-1", ...meta, symbol: "3", geometry: { kind: "text", at: { x: 12.5, y: -3.25 } }, text: "Första raden\nAndra & sista", angle: 30 },
      { kind: "modify", ...meta, ref: ref(1), text: "Ny\ntext", angle: 90, symbol: "3" },
      { kind: "modify", ...meta, ref: ref(2), geometry: { kind: "text", at: { x: 6, y: -6 } } }
    ];
    const result = applyMapRevisionWithTextSymbols(bytes, { baseFileSha256: sha, format: "OMAP", changes }, [copy, style("2", { align: "right" })]);
    if (!result.ok) throw new Error(JSON.stringify(result.refusals));
    const out = decoder.decode(result.bytes);
    const after = readMapFile(result.bytes, "ny.omap");
    expect(result.report).toMatchObject({ baseFileSha256: sha, resultSha256: sha256Hex(result.bytes), added: 1, modified: 2 });
    expect(after.symbols.get("3")).toMatchObject({ kind: "TEXT", size: 2.5, code: { text: "999.1" } });
    const plain = (object: MapObject) => { const copy = { ...object }; delete copy.source; return copy; };
    expect(after.objects.map(plain)).toEqual([
      plain(map.objects[0]!),
      { kind: "text", symbol: "3", at: { x: 0.1, y: 0.2 }, angle: 90, text: "Ny\ntext" },
      { kind: "text", symbol: "2", at: { x: 6, y: -6 }, angle: 0, text: "Rubrik" },
      { kind: "text", symbol: "3", at: { x: 12.5, y: -3.25 }, angle: 30, text: "Första raden\nAndra & sista" }
    ]);
    // Justeringen hör till objekten i Mapper: mitten för symbol 3, höger för symbol 2.
    expect(out).toContain(`<object type="4" symbol="3" h_align="1" v_align="2" rotation="1.570796327">`);
    expect(out).toContain(`<object type="4" symbol="2" h_align="2" v_align="0">`);
    expect(out).toMatch(/<object type="4" symbol="3" rotation="0.523598776" h_align="1" v_align="0"><coords count="1">12500 3250;<\/coords><text>Första raden\nAndra &amp; sista<\/text><\/object>/);
    expect(out).toContain(`<objects count="4">`);
  });

  it("ritar texten med symbolens justering och kontur under texten", () => {
    const symbols = withTextSymbolChanges(map.symbols, map.colors, [style("2", { align: "center" })]);
    const canvas = fakeContext();
    drawMap(canvas.ctx, { ...map, symbols, objects: [map.objects[2]!] }, { pxPerMm: 10, origin: { x: 0, y: 0 }, background: false });
    const calls = canvas.calls.filter(call => call.op === "strokeText" || call.op === "fillText");
    expect(calls.map(call => call.op)).toEqual(["strokeText", "fillText"]);
    expect(canvas.calls.find(call => call.op === "fillText")?.state).toMatchObject({ textAlign: "center", font: `bold 50px "Times New Roman", serif` });
  });
});

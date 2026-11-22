import { describe, expect, it } from "vitest";
import type { MapColor, MapTextSymbolChange } from "@o-tid/map-file";
import type { CatalogSymbol } from "./map-project-protocol";
import {
  cleanText, duplicateTextSymbol, editTextDraft, EMPTY_STYLE_HISTORY, finishText, fontChoices, newTextDraft, recordStyle, redoStyle, styleChange,
  textSymbolFor, undoStyle, whiteColor, withStyleChange
} from "./map-project-text";

/** K8b V6: textverktyget, redigering, byt textsymbol och textsymbolernas ändringar utan gränssnitt. */
const symbol = (id: string, code: string, kind: CatalogSymbol["kind"], extra: Partial<CatalogSymbol> = {}): CatalogSymbol =>
  ({ id, code, name: `Symbol ${code}`, kind, group: "OTHER", colors: [], count: 0, ...extra });
const style = { fontFamily: "Arial", size: 3, color: 1, bold: false, italic: false };
const catalog = [symbol("0", "101", "line"), symbol("7", "999.0", "text", { text: style }), symbol("8", "902", "text", { text: { ...style, fontFamily: "Times New Roman" } })];
const color = (id: number, name: string, k: number): MapColor => ({ id, name, rank: id, cmyk: { c: 0, m: 0, y: 0, k }, rgb: { r: 1 - k, g: 1 - k, b: 1 - k }, opacity: 1 });

describe("textverktyget (B)", () => {
  it("väljer den valda textsymbolen, annars den senast använda, annars kartans första, annars ingen", () => {
    expect(textSymbolFor(catalog[2], [], catalog)?.id).toBe("8");
    expect(textSymbolFor(catalog[0], ["0", "8"], catalog)?.id).toBe("8");
    expect(textSymbolFor(catalog[0], ["0"], catalog)?.id).toBe("7");
    expect(textSymbolFor(undefined, [], [catalog[0]!])).toBeUndefined();
  });

  it("Enter lägger in en ny text med radbrytning; tom text eller bara blanka ger inget", () => {
    const draft = newTextDraft({ x: 10, y: 20 }, "7");
    expect(finishText(draft, "Älvsjö\r\nskogen  \n")).toEqual({ kind: "ADD", object: { kind: "text", symbol: "7", at: { x: 10, y: 20 }, angle: 0, text: "Älvsjö\nskogen" } });
    expect(finishText(draft, "  \n ")).toBeUndefined();
    expect(cleanText("a\rb")).toBe("a\nb");
  });

  it("redigera: samma objekt med ny text (vinkel och plats kvar), oförändrad text ger inget", () => {
    const object = { kind: "text" as const, symbol: "8", at: { x: 1, y: 2 }, angle: 30, text: "Gammal" };
    const draft = editTextDraft({ key: "omap:0:4", ref: null, object });
    expect(draft).toMatchObject({ at: object.at, angle: 30, value: "Gammal", symbol: "8" });
    expect(finishText(draft, "Ny\ntext")).toEqual({ kind: "TEXT", object: { ...object, text: "Ny\ntext" } });
    expect(finishText(draft, "Gammal")).toBeUndefined();
  });
});

describe("textsymbolerna", () => {
  it("typsnitten: kartans egna först, sedan de vanliga, utan dubbletter", () => {
    expect(fontChoices(catalog)).toEqual(["Arial", "Times New Roman", "Helvetica", "Verdana"]);
  });

  it("konturens färg: kartans vita", () => {
    expect(whiteColor([color(0, "Svart", 1), color(3, "Vit", 0)])).toBe(3);
    expect(whiteColor([color(0, "Svart", 1)])).toBeUndefined();
  });

  it("en ändring ersätter symbolens förra; en kopia behåller källan, numret och namnet", () => {
    const first = styleChange("7", { ...style, size: 4, align: "center", framing: { color: 3, width: 0.3 } }, []);
    expect(first).toEqual({ id: "7", fontFamily: "Arial", size: 4, color: 1, bold: false, italic: false, align: "center", framing: { color: 3, width: 0.3 } });
    const saved = withStyleChange([first], styleChange("7", { ...style, bold: true }, [first]));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ bold: true, framing: null });
    const copy: MapTextSymbolChange = { ...first, id: "12", copyOf: "7", code: "999.1", name: "Liten" };
    expect(styleChange("12", style, [copy])).toMatchObject({ id: "12", copyOf: "7", code: "999.1", name: "Liten", size: 3 });
  });

  it("duplicera: nästa lediga id (också dolda symboler i filen) och nästa nummer i serien; en kopia av en kopia kopierar källan", () => {
    const copy = duplicateTextSymbol(catalog[1]!, { ...style, size: 2 }, [], catalog, ["0", "7", "8", "11"], name => `${name} (kopia)`);
    expect(copy).toMatchObject({ id: "12", copyOf: "7", code: "999.1", name: "Symbol 999.0 (kopia)", size: 2 });
    const again = duplicateTextSymbol(symbol("12", "999.1", "text", { text: style }), style, [copy], [...catalog, symbol("12", "999.1", "text")], ["0", "7", "8", "11"], name => name);
    expect(again).toMatchObject({ id: "13", copyOf: "7", code: "999.2" });
  });

  it("ångra och gör om går i ordning med objektens historik", () => {
    const a: MapTextSymbolChange[] = [], b = [styleChange("7", { ...style, size: 5 }, [])];
    let history = recordStyle(EMPTY_STYLE_HISTORY, a, b, { undo: 2, redo: 0 });
    // Ett objekt ändrat efteråt: objektet ångras först.
    expect(undoStyle(history, { undo: 3, redo: 0 })).toBeUndefined();
    const undone = undoStyle(history, { undo: 2, redo: 0 })!;
    expect(undone.changes).toBe(a);
    history = undone.history;
    // Ett nytt objekt efter Ångra: Gör om gäller inte längre textsymbolen.
    expect(redoStyle(history, { undo: 3, redo: 0 })).toBeUndefined();
    const redone = redoStyle(history, { undo: 2, redo: 0 })!;
    expect(redone.changes).toBe(b);
    expect(redone.history.undo).toHaveLength(1);
  });
});

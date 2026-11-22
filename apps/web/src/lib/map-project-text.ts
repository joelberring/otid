import { nextTextSymbolCode, nextTextSymbolId, type MapColor, type MapObject, type MapTextSymbolChange, type Point } from "@o-tid/map-file";
import type { ObjectKey, ObjectRef } from "@o-tid/map-revision";
import type { CatalogSymbol, TextStyle } from "./map-project-protocol";

/**
 * K8b V6 (ägaren 2026-11-22): textverktyget och textsymbolerna utan gränssnitt. Som i Mapper och OCAD hör typsnitt, storlek,
 * färg, fet/kursiv, justering och kontur till textsymbolen; textobjektet har text, plats och vinkel.
 */
export type TextObject = Extract<MapObject, { kind: "text" }>;

/** Textsymbolen som textverktyget (B) ritar med: den valda om den är en text, annars den senast använda, annars kartans första. */
export function textSymbolFor(current: CatalogSymbol | undefined, recent: readonly string[], catalog: readonly CatalogSymbol[]): CatalogSymbol | undefined {
  if (current?.kind === "text") return current;
  const byId = new Map(catalog.map(symbol => [symbol.id, symbol]));
  for (const id of recent) { const symbol = byId.get(id); if (symbol?.kind === "text" && !symbol.fileHidden) return symbol; }
  return catalog.find(symbol => symbol.kind === "text" && !symbol.fileHidden);
}

/** Textfältet på kartan: en ny text vid en punkt, eller ett befintligt textobjekt som redigeras. */
export interface TextDraft {
  readonly at: Point;
  readonly angle: number;
  readonly symbol: string;
  readonly value: string;
  readonly target?: { readonly key: ObjectKey; readonly ref: ObjectRef | null; readonly object: TextObject } | undefined;
}

export const newTextDraft = (at: Point, symbol: string): TextDraft => ({ at, angle: 0, symbol, value: "" });
export const editTextDraft = (target: { key: ObjectKey; ref: ObjectRef | null; object: TextObject }): TextDraft =>
  ({ at: target.object.at, angle: target.object.angle, symbol: target.object.symbol, value: target.object.text, target });

/** Texten som den sparas: radbrytningar som `\n` (som Mapper), inga blanka sist. */
export const cleanText = (value: string): string => value.replace(/\r\n?/g, "\n").replace(/\s+$/u, "");

/**
 * Vad Enter gör: en ny text (ADD) eller en ändrad text (TEXT) på samma objekt. Inget när texten är tom eller inte ändrats
 * (en tom befintlig text tas inte bort här: det gör Ta bort).
 */
export function finishText(draft: TextDraft, value: string): { kind: "ADD" | "TEXT"; object: TextObject } | undefined {
  const text = cleanText(value);
  if (!text.trim()) return undefined;
  if (draft.target) {
    if (text === draft.target.object.text) return undefined;
    return { kind: "TEXT", object: { ...draft.target.object, text } };
  }
  return { kind: "ADD", object: { kind: "text", symbol: draft.symbol, at: draft.at, angle: draft.angle, text } };
}

const COMMON_FONTS = ["Arial", "Helvetica", "Times New Roman", "Verdana"];

/** Typsnitten i listan: kartans egna först (som de används i filen), sedan de vanliga. */
export function fontChoices(catalog: readonly CatalogSymbol[]): string[] {
  const own = catalog.flatMap(symbol => symbol.text ? [symbol.text.fontFamily] : []);
  return [...new Set([...own, ...COMMON_FONTS])];
}

/** Kartans vita färg (för konturen): ingen färg i CMYK eller ett namn som säger vit. */
export function whiteColor(colors: readonly MapColor[]): number | undefined {
  const blank = colors.find(color => !color.spot && color.cmyk.c + color.cmyk.m + color.cmyk.y + color.cmyk.k < 0.001);
  return (blank ?? colors.find(color => /vit|white/i.test(color.name)))?.id;
}

/** Den sparade ändringen av en symbol (för en kopia: kopians rad med källan, numret och namnet). */
const savedOf = (saved: readonly MapTextSymbolChange[], id: string) => saved.find(change => change.id === id);

/** Ändringen som ger symbolen stilen `style`. En kopia behåller sin källa, sitt nummer och namn. */
export function styleChange(symbolId: string, style: TextStyle, saved: readonly MapTextSymbolChange[]): MapTextSymbolChange {
  const prior = savedOf(saved, symbolId);
  return { id: symbolId, ...(prior?.copyOf !== undefined ? { copyOf: prior.copyOf, code: prior.code, name: prior.name } : {}),
    fontFamily: style.fontFamily.trim(), size: style.size, color: style.color, bold: style.bold, italic: style.italic,
    ...(style.align ? { align: style.align } : {}), framing: style.framing ?? null };
}

/** Listan med en ändring till (samma symbol ersätts på sin plats, en ny läggs sist). */
export function withStyleChange(saved: readonly MapTextSymbolChange[], change: MapTextSymbolChange): MapTextSymbolChange[] {
  return saved.some(row => row.id === change.id) ? saved.map(row => row.id === change.id ? change : row) : [...saved, change];
}

/**
 * «Duplicera som ny textsymbol»: en kopia med nästa lediga id och nästa lediga nummer i samma hundratal (999.0 → 999.1). En kopia
 * av en kopia kopierar samma symbol i filen. `fileIds` är alla symbolers id i filen (också dolda).
 */
export function duplicateTextSymbol(symbol: CatalogSymbol, style: TextStyle, saved: readonly MapTextSymbolChange[], catalog: readonly CatalogSymbol[],
  fileIds: readonly string[], copyName: (name: string) => string): MapTextSymbolChange {
  const id = nextTextSymbolId([...fileIds, ...catalog.map(entry => entry.id), ...saved.map(change => change.id)]);
  const code = nextTextSymbolCode(symbol.code, [...catalog.map(entry => entry.code), ...saved.flatMap(change => change.code ? [change.code] : [])]);
  const source = savedOf(saved, symbol.id)?.copyOf ?? symbol.id;
  return { ...styleChange(symbol.id, style, []), id, copyOf: source, code, name: copyName(symbol.name).slice(0, 120) };
}

/**
 * Ångra för textsymbolerna (ändringen gäller alla texter med symbolen): stegen ligger bredvid objektens historik och tas när
 * objektens historik är lika lång som när steget gjordes, så att Ångra och Gör om går i den ordning man gjorde sakerna.
 */
export interface StyleStep {
  readonly before: readonly MapTextSymbolChange[];
  readonly after: readonly MapTextSymbolChange[];
  /** Objektens historik (antalet steg att ångra och göra om) när steget gjordes eller ångrades. */
  readonly undo: number; readonly redo: number;
}
export interface StyleHistory { readonly undo: readonly StyleStep[]; readonly redo: readonly StyleStep[] }
export const EMPTY_STYLE_HISTORY: StyleHistory = { undo: [], redo: [] };

type Lengths = { readonly undo: number; readonly redo: number };

export function recordStyle(history: StyleHistory, before: readonly MapTextSymbolChange[], after: readonly MapTextSymbolChange[], objects: Lengths): StyleHistory {
  return { undo: [...history.undo, { before, after, ...objects }], redo: [] };
}

/** Ångra: listan att spara och historiken efteråt, eller inget när objektens steg är senare (då ångras objekten). */
export function undoStyle(history: StyleHistory, objects: Lengths): { changes: readonly MapTextSymbolChange[]; history: StyleHistory } | undefined {
  const top = history.undo.at(-1);
  if (!top || top.undo !== objects.undo) return undefined;
  return { changes: top.before, history: { undo: history.undo.slice(0, -1), redo: [...history.redo, { ...top, ...objects }] } };
}

/** Gör om: bara när objekten inte har ändrats sedan steget ångrades. */
export function redoStyle(history: StyleHistory, objects: Lengths): { changes: readonly MapTextSymbolChange[]; history: StyleHistory } | undefined {
  const top = history.redo.at(-1);
  if (!top || top.redo !== objects.redo || top.undo !== objects.undo) return undefined;
  return { changes: top.after, history: { undo: [...history.undo, { ...top, ...objects }], redo: history.redo.slice(0, -1) } };
}

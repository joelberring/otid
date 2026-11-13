/**
 * Ägaren 2026-11-13 («byggnader är fortfarande gråa … kunna justera färgen på dem»): en symbols färg byts mot en annan av
 * kartans färger. Till skillnad från färgtabellens ändringar (`colors.ts`, gäller alla symboler med färgen) gäller en ändring
 * här bara en symbol: «symbolens färg `from` ritas med kartans färg `to`». En symbol med fyllning och kant, eller flera färger,
 * får en ändring per färgplats (`from` = färgen som symbolen har i filen).
 *
 * Symbolen pekas ut med symbolnumret som i filen ("521", "521.1"), så att ändringen följer med när kartan byggs om. Färgerna
 * är färgernas id (Mappers prioritet). En kombinerad symbol (yta med kantlinje) ändras i sina egna (privata) delar; delar som
 * andra symboler delar har en egen rad.
 *
 * `applyMapSymbolColors` skriver ändringarna i en Mapper-fil som ett eget steg efter färgtabellen, och filen läses om och
 * jämförs med modellen som `withSymbolColorChanges` ger.
 */
import { MapFileError, type MapColor, type MapSymbol, type ParsedMap, type PointElement, type StrokeStyle } from "../model";
import { findTag, readOmap } from "../omap/read";
import type { MapColorsResult } from "./colors";
import { elementEnd } from "./omap-scan";

export interface MapSymbolColorChange { readonly symbol: string; readonly from: number; readonly to: number }

type Remap = (color: number) => number;

const element = (item: PointElement, remap: Remap): PointElement => ({ ...item, color: remap(item.color) });
const elements = (items: readonly PointElement[]) => items.map(item => item.color);
const strokes = (items: readonly StrokeStyle[]) => items.map(item => item.color);

/** Delarna som bara den kombinerade symbolen har (id som `<id>.<n>`). */
const privateParts = (symbols: ReadonlyMap<string, MapSymbol>, symbol: MapSymbol): MapSymbol[] =>
  symbol.kind !== "COMBINED" ? [] : symbol.parts.filter(id => id.startsWith(`${symbol.id}.`)).flatMap(id => symbols.get(id) ?? []);

function ownColors(symbol: MapSymbol): number[] {
  switch (symbol.kind) {
    case "POINT": return elements(symbol.elements);
    case "TEXT": return [symbol.color];
    case "COMBINED": return [];
    case "LINE": return [...strokes(symbol.strokes), ...elements(symbol.repeated?.elements ?? []), ...elements(symbol.between?.elements ?? []),
      ...elements(symbol.corner?.elements ?? []), ...elements(symbol.start?.elements ?? []), ...elements(symbol.end?.elements ?? [])];
    case "AREA": return [...(symbol.fill === undefined ? [] : [symbol.fill]), ...symbol.hatches.map(hatch => hatch.color),
      ...elements(symbol.pattern?.elements ?? []), ...strokes(symbol.border ?? [])];
  }
}

/** Färgerna symbolen ritas med, i den ordning de först förekommer (utan dubbletter). */
export function symbolColorIds(symbols: ReadonlyMap<string, MapSymbol>, symbol: MapSymbol): number[] {
  return [...new Set([...ownColors(symbol), ...privateParts(symbols, symbol).flatMap(part => ownColors(part))])];
}

function recolor(symbol: MapSymbol, remap: Remap): MapSymbol {
  const stroke = (item: StrokeStyle): StrokeStyle => ({ ...item, color: remap(item.color) });
  const group = <T extends { readonly elements: readonly PointElement[] }>(value: T | undefined): T | undefined =>
    value && { ...value, elements: value.elements.map(item => element(item, remap)) };
  switch (symbol.kind) {
    case "POINT": return { ...symbol, elements: symbol.elements.map(item => element(item, remap)) };
    case "TEXT": return { ...symbol, color: remap(symbol.color) };
    case "COMBINED": return symbol;
    case "LINE": return { ...symbol, strokes: symbol.strokes.map(stroke), repeated: group(symbol.repeated), between: group(symbol.between),
      corner: group(symbol.corner), start: group(symbol.start), end: group(symbol.end) };
    case "AREA": return { ...symbol, ...(symbol.fill === undefined ? {} : { fill: remap(symbol.fill) }),
      hatches: symbol.hatches.map(hatch => ({ ...hatch, color: remap(hatch.color) })), pattern: group(symbol.pattern), border: symbol.border?.map(stroke) };
  }
}

const symbolsWithCode = (symbols: ReadonlyMap<string, MapSymbol>, code: string) =>
  [...symbols.values()].filter(symbol => symbol.code.text === code && code !== "");

/**
 * Ändringarna som gäller för kartan: okända symboler, färger som symbolen inte har, färger som inte finns i tabellen och
 * ändringar som inte byter något hoppas över. En ändring per symbol och färgplats (den sista gäller).
 */
export function effectiveSymbolColorChanges(symbols: ReadonlyMap<string, MapSymbol>, colors: readonly MapColor[],
  changes: readonly MapSymbolColorChange[]): MapSymbolColorChange[] {
  const known = new Set(colors.map(color => color.id));
  const out = new Map<string, MapSymbolColorChange>();
  for (const change of changes) {
    if (change.from === change.to || !known.has(change.to)) continue;
    const have = symbolsWithCode(symbols, change.symbol);
    if (!have.some(symbol => symbolColorIds(symbols, symbol).includes(change.from))) continue;
    out.set(`${change.symbol}\n${change.from}`, { symbol: change.symbol, from: change.from, to: change.to });
  }
  return [...out.values()].sort((a, b) => a.symbol.localeCompare(b.symbol, "sv", { numeric: true }) || a.from - b.from);
}

/** Symbolerna med färgbytena (symboltabellen i övrigt oförändrad). */
export function withSymbolColorChanges(symbols: ReadonlyMap<string, MapSymbol>, colors: readonly MapColor[],
  changes: readonly MapSymbolColorChange[]): Map<string, MapSymbol> {
  const wanted = effectiveSymbolColorChanges(symbols, colors, changes);
  const out = new Map(symbols);
  if (wanted.length === 0) return out;
  for (const symbol of symbols.values()) {
    const mine = wanted.filter(change => change.symbol === symbol.code.text);
    if (mine.length === 0) continue;
    const byFrom = new Map(mine.map(change => [change.from, change.to]));
    const remap: Remap = color => byFrom.get(color) ?? color;
    out.set(symbol.id, recolor(symbol, remap));
    for (const part of privateParts(symbols, symbol)) out.set(part.id, recolor(part, remap));
  }
  return out;
}

const COLOR_ATTRIBUTE = /(\s(?:color|inner_color|outer_color)=")(\d+)(")/g;
const fail = (message: string): MapColorsResult => ({ ok: false, message });

export function applyMapSymbolColors(original: Uint8Array, changes: readonly MapSymbolColorChange[]): MapColorsResult {
  if (changes.length === 0) return { ok: true, bytes: original, changed: 0 };
  if (original.length >= 2 && original[0] === 0xad && original[1] === 0x0c) {
    return fail("Symbolernas färger kan inte skrivas i en OCAD-fil här än. Spara kartan i Mapper (.omap) först.");
  }
  const bom = original.length >= 3 && original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf ? 3 : 0;
  let text: string, before: ParsedMap;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(original.subarray(bom));
    before = readOmap(text);
  } catch (error) {
    return fail(error instanceof MapFileError ? error.message : "Mapper-filen är inte giltig UTF-8.");
  }
  const wanted = effectiveSymbolColorChanges(before.symbols, before.colors, changes);
  if (wanted.length === 0) return { ok: true, bytes: original, changed: 0 };
  const start = findTag(text, "<symbols", 0), end = start < 0 ? -1 : text.indexOf("</symbols>", start);
  if (start < 0 || end < 0) return fail("Mapper-filen har ingen symboltabell.");
  let out = "", at = 0, done = 0;
  for (let open = findTag(text, "<symbol", start); open >= 0 && open < end;) {
    const stop = symbolEnd(text, open, end);
    if (stop < 0) return fail("Mapper-filens symboltabell är avkortad.");
    const tagEnd = text.indexOf(">", open) + 1;
    const code = /\scode="([^"]*)"/.exec(text.slice(open, tagEnd))?.[1] ?? "";
    const mine = wanted.filter(change => change.symbol === code);
    if (mine.length > 0) {
      const byFrom = new Map(mine.map(change => [String(change.from), String(change.to)]));
      const body = text.slice(open, stop).replace(COLOR_ATTRIBUTE, (all, head: string, value: string, tail: string) => {
        const next = byFrom.get(value);
        return next === undefined ? all : `${head}${next}${tail}`;
      });
      out += text.slice(at, open) + body;
      at = stop;
      done += mine.length;
    }
    open = findTag(text, "<symbol", stop);
  }
  const result = out + text.slice(at);
  // Kontrollen: filen läses om; symbolerna är som modellen med färgbytena, allt annat som förut.
  let after: ParsedMap;
  try { after = readOmap(result); } catch { return fail("Kontrollen efter symbolfärgerna: filen går inte att läsa."); }
  const expected = withSymbolColorChanges(before.symbols, before.colors, wanted);
  const strip = (map: ParsedMap) => JSON.stringify([map.colors, map.objects.length, map.scale]);
  if (JSON.stringify([...after.symbols]) !== JSON.stringify([...expected]) || strip(after) !== strip(before)) {
    return fail("Kontrollen efter symbolfärgerna: något annat än symbolernas färger ändrades.");
  }
  const encoded = new TextEncoder().encode(result), bytes = new Uint8Array(bom + encoded.length);
  bytes.set(original.subarray(0, bom));
  bytes.set(encoded, bom);
  return { ok: true, bytes, changed: done };
}

/** Slutet på `<symbol>`-elementet som börjar vid `open` (inbyggda `<symbol>` i mittsymboler och delar räknas med). */
function symbolEnd(text: string, open: number, limit: number): number {
  const tagEnd = text.indexOf(">", open);
  if (tagEnd < 0 || tagEnd >= limit) return -1;
  if (text.charCodeAt(tagEnd - 1) === 47) return tagEnd + 1;
  let depth = 1, at = tagEnd + 1;
  while (depth > 0) {
    const close = text.indexOf("</symbol>", at);
    if (close < 0 || close >= limit) return -1;
    const inner = findTag(text, "<symbol", at);
    if (inner >= 0 && inner < close) {
      const innerEnd = elementEnd(text, inner, "symbol", limit);
      // Ett självstängande inre element ändrar inte djupet; annars räknas det som ett öppet.
      if (innerEnd >= 0 && text.charCodeAt(text.indexOf(">", inner) - 1) === 47) { at = innerEnd; continue; }
      depth += 1; at = text.indexOf(">", inner) + 1; continue;
    }
    depth -= 1; at = close + "</symbol>".length;
  }
  return at;
}

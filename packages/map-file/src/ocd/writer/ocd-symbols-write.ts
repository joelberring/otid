/**
 * Symbolmutationer på `OcdDocument` (OCAD 9–2018+):
 * - `applyOcdSymbolColors`: uppdaterar färgreferenser inuti befintliga symbolposter (byte-för-byte för orörda fält!).
 * - `applyOcdTextSymbols`: uppdaterar befintliga eller lägger till kopierade `TTextSym`-poster.
 * - `applyOcdNormSymbols`: ersätter eller lägger till normsymboler (`SymbolDef`) med automatiska `BorderSym`-linjer,
 *   saknade färger på rätt IOF-plats, `Extent`, `Colors[0..13]` och 22×22 `IconBits`.
 */
import { MapFileError, type MapColor, type MapSymbol, type ParsedMap, type TextSymbol } from "../../model";
import type { MapColorsResult } from "../../revision/colors";
import type { MapSymbolColorChange } from "../../revision/symbol-colors";
import type { SymbolReplacement } from "../../revision/symbol-replace";
import { effectiveTextSymbolChanges, type MapTextSymbolChange, type TextSymbolsResult } from "../../revision/text-symbols";
import type { ColorDef, ElementDef, SymbolDef } from "../../template/symbol-def";
import { Bytes } from "../bytes";
import { AREA, ELEMENT, LINE, POINT, RECTANGLE, SYMBOL, SYMBOL_TYPE, TEXT, type OcdVariant } from "../layout";
import { readOcd } from "../read";
import { WarningCollector } from "../../warnings";
import { readOcdSymbols } from "../symbols";
import { applyOcdColors, documentColors } from "./ocd-colors-write";
import { parseOcdDocument, type OcdDocument, type RawOcdSymbol } from "./ocd-document";
import { computeSymbolExtentUnits, iconBitsOffset, renderOcdSymbolIcon, writeSymbolDescription, writeSymbolHeaderColors } from "./ocd-icon";
import { packOcdDocument, verifyOcdDocument } from "./ocd-pack";
import {
  allocateHelperBorderNumber, allocateOcdSymbolNumber, encodeOcdSymbol, ocdNumberMatchesCode, symbolDefToMapSymbol, writeTextBodyFields
} from "./ocd-symbols-encode";

const BODY_V12 = 796;
const TEXT_BODY_SIZE = 240;

export interface OcdSymbolMutationStats {
  readonly changed: number;
  /** Mappning från in-memory symbol-id (t.ex. `change.id` eller `withSymbolReplacements`-id) till verkligt OCAD-`SymNum`. */
  readonly symbolIdMap: ReadonlyMap<string, string>;
}

/** Läser ett enskilt `RawOcdSymbol` genom O-Tids vanliga OCAD-symbolläsare (för ikon- och extent-beräkning). */
function parseSingleSymbol(raw: RawOcdSymbol, doc: OcdDocument): MapSymbol | undefined {
  // Bygg ett litet 1-slots symbolblock på offset 8 (offset 0 betyder "inget symbolblock" i `readOcdSymbols`!).
  const start = 8;
  const blockSize = 4 + 256 * 4;
  const symAt = start + blockSize;
  const buf = new Uint8Array(symAt + raw.bytes.length);
  const view = new DataView(buf.buffer);
  view.setInt32(start + 4, symAt, true);
  buf.set(raw.bytes, symAt);
  const warnings = new WarningCollector();
  const parsed = readOcdSymbols(new Bytes(buf), start, warnings, doc.variant);
  return parsed.get(String(raw.number));
}

function collectRawColors(sym: RawOcdSymbol, variant: OcdVariant): number[] {
  const bytes = new Bytes(sym.bytes);
  const at = variant.symbolBody - BODY_V12;
  const end = sym.bytes.length;
  const out: number[] = [];
  const add = (c: number) => { if (c >= 0) out.push(c); };
  const scanEl = (start: number, words: number) => {
    const stop = Math.min(end, start + words * 8);
    let pos = start;
    while (pos + ELEMENT.header <= stop) {
      add(bytes.u16(pos + ELEMENT.color));
      pos += ELEMENT.header + bytes.u16(pos + ELEMENT.coordCount) * 8;
    }
  };
  if (sym.type === SYMBOL_TYPE.point && at + POINT.elements <= end) {
    scanEl(at + POINT.elements, bytes.u16(at + POINT.dataSize));
  } else if (sym.type === SYMBOL_TYPE.line && at + LINE.elements <= end) {
    if (bytes.i16(at + LINE.width) > 0) add(bytes.i16(at + LINE.color));
    if (bytes.i16(at + LINE.framingWidth) > 0) add(bytes.i16(at + LINE.framingColor));
    if (bytes.u16(at + LINE.doubleMode) !== 0) {
      if ((bytes.u16(at + LINE.doubleFlags) & 1) !== 0 && bytes.i16(at + LINE.doubleWidth) > 0) add(bytes.i16(at + LINE.doubleColor));
      if (bytes.i16(at + LINE.doubleLeftWidth) > 0) add(bytes.i16(at + LINE.doubleLeftColor));
      if (bytes.i16(at + LINE.doubleRightWidth) > 0) add(bytes.i16(at + LINE.doubleRightColor));
    }
    let pos = at + LINE.elements;
    for (const off of [LINE.primaryDataSize, LINE.secondaryDataSize, LINE.cornerDataSize, LINE.startDataSize, LINE.endDataSize]) {
      const words = bytes.u16(at + off);
      if (words > 0) scanEl(pos, words);
      pos += words * 8;
    }
  } else if (sym.type === SYMBOL_TYPE.area && at + variant.areaData.elements <= end) {
    if (bytes.u8(at + AREA.fillOn) !== 0) add(bytes.u16(at + AREA.fillColor));
    const hm = bytes.u16(at + AREA.hatchMode);
    if (hm === 1 || hm === 2) add(bytes.u16(at + AREA.hatchColor));
    const sm = bytes.u8(at + AREA.structureMode);
    if (sm === 1 || sm === 2) scanEl(at + variant.areaData.elements, bytes.u16(at + variant.areaData.dataSize));
  } else if ((sym.type === SYMBOL_TYPE.text || sym.type === SYMBOL_TYPE.lineText) && at + TEXT.color + 2 <= end) {
    add(bytes.u16(at + TEXT.color));
    if (sym.type === SYMBOL_TYPE.text && at + TEXT.framingEnd <= end && bytes.u8(at + TEXT.frMode) === 2) add(bytes.i16(at + TEXT.frColor));
  } else if (sym.type === SYMBOL_TYPE.rectangle && at + RECTANGLE.width + 2 <= end) {
    add(bytes.u16(at + RECTANGLE.color));
  }
  return out;
}

/** Byter färgreferenser i en symbolpost på plats (returnerar true om någon färg byttes). */
function remapRawSymbolColors(sym: RawOcdSymbol, remap: ReadonlyMap<number, number>, variant: OcdVariant): boolean {
  const copy = sym.bytes.slice();
  const view = new DataView(copy.buffer);
  const at = variant.symbolBody - BODY_V12;
  const end = copy.length;
  let dirty = false;

  const swapI16 = (offset: number) => {
    if (offset < 0 || offset + 2 > end) return;
    const cur = view.getInt16(offset, true);
    const next = remap.get(cur);
    if (next !== undefined && next !== cur) { view.setInt16(offset, next, true); dirty = true; }
  };
  const swapU16 = (offset: number) => {
    if (offset < 0 || offset + 2 > end) return;
    const cur = view.getUint16(offset, true);
    const next = remap.get(cur);
    if (next !== undefined && next !== cur) { view.setUint16(offset, next, true); dirty = true; }
  };
  const swapElements = (start: number, words: number) => {
    const stop = Math.min(end, start + words * 8);
    let pos = start;
    while (pos + ELEMENT.header <= stop) {
      swapU16(pos + ELEMENT.color);
      pos += ELEMENT.header + view.getUint16(pos + ELEMENT.coordCount, true) * 8;
    }
  };

  if (sym.type === SYMBOL_TYPE.point && at + POINT.elements <= end) {
    swapElements(at + POINT.elements, view.getUint16(at + POINT.dataSize, true));
  } else if (sym.type === SYMBOL_TYPE.line && at + LINE.elements <= end) {
    if (view.getInt16(at + LINE.width, true) > 0) swapI16(at + LINE.color);
    if (view.getInt16(at + LINE.framingWidth, true) > 0) swapI16(at + LINE.framingColor);
    if (view.getUint16(at + LINE.doubleMode, true) !== 0) {
      if ((view.getUint16(at + LINE.doubleFlags, true) & 1) !== 0 && view.getInt16(at + LINE.doubleWidth, true) > 0) swapI16(at + LINE.doubleColor);
      if (view.getInt16(at + LINE.doubleLeftWidth, true) > 0) swapI16(at + LINE.doubleLeftColor);
      if (view.getInt16(at + LINE.doubleRightWidth, true) > 0) swapI16(at + LINE.doubleRightColor);
    }
    let pos = at + LINE.elements;
    for (const off of [LINE.primaryDataSize, LINE.secondaryDataSize, LINE.cornerDataSize, LINE.startDataSize, LINE.endDataSize]) {
      const words = view.getUint16(at + off, true);
      if (words > 0) swapElements(pos, words);
      pos += words * 8;
    }
  } else if (sym.type === SYMBOL_TYPE.area && at + variant.areaData.elements <= end) {
    if (copy[at + AREA.fillOn] !== 0) swapU16(at + AREA.fillColor);
    const hm = view.getUint16(at + AREA.hatchMode, true);
    if (hm === 1 || hm === 2) swapU16(at + AREA.hatchColor);
    const sm = copy[at + AREA.structureMode];
    if (sm === 1 || sm === 2) swapElements(at + variant.areaData.elements, view.getUint16(at + variant.areaData.dataSize, true));
  } else if ((sym.type === SYMBOL_TYPE.text || sym.type === SYMBOL_TYPE.lineText) && at + TEXT.color + 2 <= end) {
    swapU16(at + TEXT.color);
    if (sym.type === SYMBOL_TYPE.text && at + TEXT.framingEnd <= end && copy[at + TEXT.frMode] === 2) swapI16(at + TEXT.frColor);
  } else if (sym.type === SYMBOL_TYPE.rectangle && at + RECTANGLE.width + 2 <= end) {
    swapU16(at + RECTANGLE.color);
  }

  if (!dirty) return false;
  sym.bytes = copy;
  writeSymbolHeaderColors(sym.bytes, collectRawColors(sym, variant));
  return true;
}

/** Uppdaterar symbolfärger direkt i `OcdDocument` (bevarar orörda symboler och okända fält byte-för-byte). */
export function applyOcdSymbolColors(doc: OcdDocument, changes: readonly MapSymbolColorChange[]): { readonly changed: number } {
  if (changes.length === 0) return { changed: 0 };
  const colors = documentColors(doc);
  const validColorIds = new Set(colors.map(c => c.id));
  const byCode = new Map<string, Map<number, number>>();
  for (const change of changes) {
    if (change.from === change.to || !validColorIds.has(change.to)) continue;
    let map = byCode.get(change.symbol);
    if (!map) { map = new Map(); byCode.set(change.symbol, map); }
    map.set(change.from, change.to);
  }
  if (byCode.size === 0) return { changed: 0 };

  const at = doc.variant.symbolBody - BODY_V12;
  let changed = 0;

  // Räkna hur många objekt och ytsymboler som refererar varje symbolnummer (för delade BorderSym).
  const objectCounts = new Map<number, number>();
  for (const obj of doc.objects) objectCounts.set(obj.symbol, (objectCounts.get(obj.symbol) ?? 0) + 1);
  const borderRefCounts = new Map<number, number>();
  for (const sym of doc.symbols) {
    if (sym.type === SYMBOL_TYPE.area && at + AREA.borderOn < sym.bytes.length && sym.bytes[at + AREA.borderOn] !== 0) {
      const bSym = new DataView(sym.bytes.buffer, sym.bytes.byteOffset).getInt32(at + AREA.borderSymbol, true);
      if (bSym > 0) borderRefCounts.set(bSym, (borderRefCounts.get(bSym) ?? 0) + 1);
    }
  }

  const refreshIcon = (sym: RawOcdSymbol) => {
    const parsed = parseSingleSymbol(sym, doc);
    if (parsed) sym.bytes.set(renderOcdSymbolIcon(parsed, colors), iconBitsOffset(doc.variant));
  };

  for (const sym of [...doc.symbols]) {
    const remap = new Map<number, number>();
    for (const [code, entries] of byCode) {
      if (ocdNumberMatchesCode(sym.number, code)) {
        for (const [from, to] of entries) remap.set(from, to);
      }
    }
    if (remap.size === 0) continue;

    let symChanged = remapRawSymbolColors(sym, remap, doc.variant);

    // Om ytsymbolen har en kantlinje (`BorderSym`), uppdatera även kantlinjens färg.
    if (sym.type === SYMBOL_TYPE.area && at + AREA.borderOn < sym.bytes.length && sym.bytes[at + AREA.borderOn] !== 0) {
      const areaView = new DataView(sym.bytes.buffer, sym.bytes.byteOffset);
      const borderNum = areaView.getInt32(at + AREA.borderSymbol, true);
      const borderSym = borderNum > 0 ? doc.symbols.find(s => s.number === borderNum) : undefined;
      if (borderSym && borderSym.type === SYMBOL_TYPE.line) {
        const borderUsesRemapped = collectRawColors(borderSym, doc.variant).some(c => remap.has(c));
        if (borderUsesRemapped) {
          const shared = (objectCounts.get(borderNum) ?? 0) > 0 || (borderRefCounts.get(borderNum) ?? 0) > 1;
          if (shared) {
            const cloneNum = allocateHelperBorderNumber(doc, sym.number);
            const cloneBytes = borderSym.bytes.slice();
            const cv = new DataView(cloneBytes.buffer);
            cv.setInt32(SYMBOL.number, cloneNum, true);
            cv.setUint8(SYMBOL.status, 2); // dold hjälpsymbol
            const clone: RawOcdSymbol = { number: cloneNum, type: borderSym.type, status: 2, filePos: 0, bytes: cloneBytes };
            if (remapRawSymbolColors(clone, remap, doc.variant)) {
              refreshIcon(clone);
              doc.symbols.push(clone);
              const updatedArea = sym.bytes.slice();
              new DataView(updatedArea.buffer).setInt32(at + AREA.borderSymbol, cloneNum, true);
              sym.bytes = updatedArea;
              symChanged = true;
            }
          } else if (remapRawSymbolColors(borderSym, remap, doc.variant)) {
            refreshIcon(borderSym);
            symChanged = true;
          }
        }
      }
    }

    if (symChanged) {
      refreshIcon(sym);
      changed += 1;
    }
  }
  return { changed };
}

/** Dropp-in för `revision/symbol-colors.ts` på OCAD-filer. */
export function applyOcdSymbolColorChanges(original: Uint8Array, changes: readonly MapSymbolColorChange[]): MapColorsResult {
  if (changes.length === 0) return { ok: true, bytes: original, changed: 0 };
  let before: ParsedMap;
  let doc: OcdDocument;
  try {
    before = readOcd(original);
    doc = parseOcdDocument(original);
  } catch (error) {
    return { ok: false, message: error instanceof MapFileError ? error.message : "OCAD-filen går inte att läsa." };
  }
  const { changed } = applyOcdSymbolColors(doc, changes);
  if (changed === 0) return { ok: true, bytes: original, changed: 0 };
  const packed = packOcdDocument(doc);
  const verified = verifyOcdDocument(packed.bytes, { exactObjects: before.objects.length });
  if (!verified.ok) return { ok: false, message: verified.message };
  if (verified.map.colors.length !== before.colors.length || verified.map.scale !== before.scale) {
    return { ok: false, message: "Kontrollen efter OCAD-symbolfärgerna: färgtabell eller skala ändrades oväntat." };
  }
  return { ok: true, bytes: packed.bytes, changed };
}

/** Uppdaterar befintliga eller skapar kopierade `TTextSym` i `OcdDocument`. */
export function applyOcdTextSymbols(doc: OcdDocument, changes: readonly MapTextSymbolChange[]): OcdSymbolMutationStats {
  const symbolIdMap = new Map<string, string>();
  if (changes.length === 0) return { changed: 0, symbolIdMap };

  const colors = documentColors(doc);
  const parsedSymbols = new Map<string, MapSymbol>();
  for (const raw of doc.symbols) {
    const parsed = parseSingleSymbol(raw, doc);
    if (parsed) parsedSymbols.set(parsed.id, parsed);
  }
  const wanted = effectiveTextSymbolChanges(parsedSymbols, colors, changes);
  if (wanted.length === 0) return { changed: 0, symbolIdMap };

  const shift = doc.variant.symbolBody - BODY_V12;
  const minTextSize = doc.variant.symbolBody + TEXT_BODY_SIZE;
  let changed = 0;

  for (const change of wanted) {
    const isCopy = change.copyOf !== undefined;
    const sourceId = change.copyOf ?? change.id;
    const sourceNum = Number(sourceId);
    const sourceRaw = doc.symbols.find(s => s.number === sourceNum && (s.type === SYMBOL_TYPE.text || s.type === SYMBOL_TYPE.lineText));
    const sourceParsed = parsedSymbols.get(sourceId);
    if (!sourceRaw || !sourceParsed || sourceParsed.kind !== "TEXT") continue;

    // Säkerställ att symbolposten rymmer fullständig TTextSym inkl. framing (1036 B i v12).
    const targetLen = Math.max(sourceRaw.bytes.length, minTextSize);
    const buf = new Uint8Array(targetLen);
    buf.set(sourceRaw.bytes);
    const view = new DataView(buf.buffer);

    let symNumber = sourceRaw.number;
    if (isCopy) {
      symNumber = allocateOcdSymbolNumber(doc, change.code ?? change.id);
      view.setInt32(SYMBOL.size, targetLen, true);
      view.setInt32(SYMBOL.number, symNumber, true);
      view.setUint8(SYMBOL.type, SYMBOL_TYPE.text);
      writeSymbolDescription(buf, change.name ?? sourceParsed.name, doc.variant);
      if (String(symNumber) !== change.id) symbolIdMap.set(change.id, String(symNumber));
    } else {
      view.setInt32(SYMBOL.size, targetLen, true);
    }

    const updatedText: TextSymbol = {
      ...sourceParsed,
      id: String(symNumber),
      name: isCopy ? (change.name ?? sourceParsed.name) : sourceParsed.name,
      fontFamily: change.fontFamily,
      size: change.size,
      color: change.color,
      bold: change.bold,
      italic: change.italic,
      align: change.align ?? sourceParsed.align,
      framing: change.framing ?? undefined
    };

    writeTextBodyFields(buf, view, BODY_V12 + shift, updatedText);
    const usedColors = updatedText.framing ? [updatedText.color, updatedText.framing.color] : [updatedText.color];
    writeSymbolHeaderColors(buf, usedColors);
    view.setInt32(SYMBOL.extent, computeSymbolExtentUnits(updatedText), true);
    buf.set(renderOcdSymbolIcon(updatedText, colors), iconBitsOffset(doc.variant));

    if (isCopy) {
      const added: RawOcdSymbol = { number: symNumber, type: SYMBOL_TYPE.text, status: sourceRaw.status, filePos: 0, bytes: buf };
      doc.symbols.push(added);
      parsedSymbols.set(String(symNumber), updatedText);
    } else {
      sourceRaw.bytes = buf;
      parsedSymbols.set(String(symNumber), updatedText);
    }
    changed += 1;
  }

  return { changed, symbolIdMap };
}

/** Dropp-in för `revision/text-symbols.ts` på OCAD-filer. */
export function applyOcdTextSymbolChanges(
  original: Uint8Array,
  changes: readonly MapTextSymbolChange[]
): TextSymbolsResult & { readonly symbolIdMap?: ReadonlyMap<string, string> } {
  if (changes.length === 0) return { ok: true, bytes: original, changed: 0 };
  let before: ParsedMap;
  let doc: OcdDocument;
  try {
    before = readOcd(original);
    doc = parseOcdDocument(original);
  } catch (error) {
    return { ok: false, message: error instanceof MapFileError ? error.message : "OCAD-filen går inte att läsa." };
  }
  const { changed, symbolIdMap } = applyOcdTextSymbols(doc, changes);
  if (changed === 0) return { ok: true, bytes: original, changed: 0, symbolIdMap };
  const packed = packOcdDocument(doc);
  const verified = verifyOcdDocument(packed.bytes, { exactObjects: before.objects.length });
  if (!verified.ok) return { ok: false, message: verified.message };
  return { ok: true, bytes: packed.bytes, changed, symbolIdMap };
}

// --- Normsymboler (utbyte och tillägg) ------------------------------------------------------------------------------

const close = (a: number, b: number) => Math.abs(a - b) < 0.011;
/** Matchar normens färg mot kartans färgtabell — även dekorfärger (OCAD- och Mapper-kartor med spotfärger fungerar!). */
const sameColorDef = (color: MapColor, def: ColorDef) =>
  close(color.cmyk.c, def.cmyk[0]) && close(color.cmyk.m, def.cmyk[1]) && close(color.cmyk.y, def.cmyk[2]) && close(color.cmyk.k, def.cmyk[3]);

function elementDefKeys(elements: readonly ElementDef[] | undefined): string[] {
  return (elements ?? []).map(el => el.color);
}

function defColorKeys(def: SymbolDef): string[] {
  switch (def.kind) {
    case "point": return elementDefKeys(def.elements);
    case "text": return [def.color];
    case "line": return [...(def.color ? [def.color] : []), ...(def.border ? [def.border.color] : []), ...elementDefKeys(def.mid?.elements)];
    case "area": return [
      ...(def.fill ? [def.fill] : []), ...(def.hatches ?? []).map(h => h.color),
      ...elementDefKeys(def.dots?.elements), ...(def.border ? [def.border.color] : [])
    ];
  }
}

function resolveNormColors(doc: OcdDocument, items: readonly SymbolReplacement[]): Map<string, number> {
  let colors = documentColors(doc);
  const keyToId = new Map<string, number>();
  const find = (def: ColorDef) => colors.find(c => c.name === def.name && sameColorDef(c, def))
    ?? (def.distinct ? undefined : colors.find(c => sameColorDef(c, def)));
  const isWhite = (def: ColorDef) => def.cmyk.every(v => v === 0);
  const neighbour = (def: ColorDef) => isWhite(def) ? colors.find(c => c.name === def.name && sameColorDef(c, def)) : find(def);

  for (const item of items) {
    for (const key of defColorKeys(item.def)) {
      if (keyToId.has(key)) continue;
      const idx = item.palette.findIndex(c => c.key === key);
      const def = item.palette[idx];
      if (!def) throw new MapFileError("INVALID", `Normens färg ${key} saknas.`);
      const found = find(def);
      if (found) {
        keyToId.set(key, found.id);
        continue;
      }
      const below = item.palette.slice(idx + 1).map(neighbour).find(c => !!c);
      const [c, m, y, k] = def.cmyk;
      const stats = applyOcdColors(doc, [{
        kind: "add",
        name: def.name,
        cmyk: { c, m, y, k },
        ...(below ? { beforeId: below.id } : {})
      }]);
      const addedId = stats.addedIds[0];
      if (addedId !== undefined) {
        keyToId.set(key, addedId);
        colors = documentColors(doc);
      }
    }
  }
  return keyToId;
}

/**
 * Applicerar normsymbolutbyten (`replacements`) och tillägg (`additions`) på `OcdDocument`.
 * Lägger automatiskt in saknade färger på rätt IOF-rang utan att flytta befintliga färg-id:n, skapar dolda
 * `BorderSym`-linjesymboler för kantade ytor och returnerar `symbolIdMap` för `withSymbolReplacements`-id:n.
 */
export function applyOcdNormSymbols(
  doc: OcdDocument,
  replacements: readonly SymbolReplacement[],
  additions: readonly SymbolReplacement[] = []
): OcdSymbolMutationStats {
  const all = [...additions, ...replacements];
  const symbolIdMap = new Map<string, string>();
  if (all.length === 0) return { changed: 0, symbolIdMap };

  // Deduplicera per kod (sista vinner) och filtrera effektiva utbyten vs tillägg.
  const hasCode = (code: string) => doc.symbols.some(s => ocdNumberMatchesCode(s.number, code));
  const wanted = [...new Map(all.filter(row => hasCode(row.code) !== Boolean(row.add)).map(row => [row.code, row])).values()];
  if (wanted.length === 0) return { changed: 0, symbolIdMap };

  // Matcha in-memory id från `withSymbolReplacements` (`firstFreeId = max + 1000` över kända symboltyper som `readOcd` läser).
  const recognized = doc.symbols.filter(
    s => s.type === SYMBOL_TYPE.point || s.type === SYMBOL_TYPE.line || s.type === SYMBOL_TYPE.area ||
      s.type === SYMBOL_TYPE.text || s.type === SYMBOL_TYPE.lineText || s.type === SYMBOL_TYPE.rectangle
  );
  let virtualNextId = Math.max(-1, ...recognized.map(s => s.number)) + 1000;

  const keyToColorId = resolveNormColors(doc, wanted);
  const colors = documentColors(doc);
  let changed = 0;

  for (const row of wanted) {
    const factor = row.factor ?? 1;
    if (row.add) {
      const virtualId = String(virtualNextId++);
      const symNum = allocateOcdSymbolNumber(doc, row.code);
      if (virtualId !== String(symNum)) symbolIdMap.set(virtualId, String(symNum));
      const { symbol, rotatable, staggered, borderLine } = symbolDefToMapSymbol(row.def, symNum, factor, keyToColorId);
      let borderSymNumber: number | undefined;
      if (borderLine) {
        borderSymNumber = allocateHelperBorderNumber(doc, symNum);
        const encodedBorder = encodeOcdSymbol(
          { ...borderLine, id: String(borderSymNumber) },
          { number: borderSymNumber, variant: doc.variant, colors, status: 2 }
        );
        doc.symbols.push(encodedBorder);
      }
      const encoded = encodeOcdSymbol(symbol, {
        number: symNum, variant: doc.variant, colors, rotatable, staggered, borderSymbolNumber: borderSymNumber
      });
      doc.symbols.push(encoded);
      changed += 1;
      continue;
    }

    // Utbyte av befintliga symboler med matchande kod: behåll nummer, namn och dold-status!
    const matches = doc.symbols.filter(s => ocdNumberMatchesCode(s.number, row.code));
    for (const existing of matches) {
      const parsedOld = parseSingleSymbol(existing, doc);
      const keepName = parsedOld?.name || row.def.name;
      const { symbol, rotatable, staggered, borderLine } = symbolDefToMapSymbol(row.def, existing.number, factor, keyToColorId, keepName);
      let borderSymNumber: number | undefined;
      if (borderLine) {
        borderSymNumber = allocateHelperBorderNumber(doc, existing.number);
        const encodedBorder = encodeOcdSymbol(
          { ...borderLine, id: String(borderSymNumber) },
          { number: borderSymNumber, variant: doc.variant, colors, status: 2 }
        );
        doc.symbols.push(encodedBorder);
      }
      const encoded = encodeOcdSymbol(symbol, {
        number: existing.number, variant: doc.variant, colors, status: existing.status, rotatable, staggered, borderSymbolNumber: borderSymNumber
      });
      existing.type = encoded.type;
      existing.bytes = encoded.bytes;
      changed += 1;
    }
  }

  return { changed, symbolIdMap };
}

/** Dropp-in för `revision/symbol-replace.ts` på OCAD-filer. */
export function applyOcdSymbolReplacementChanges(
  original: Uint8Array,
  replacements: readonly SymbolReplacement[]
): MapColorsResult & { readonly symbolIdMap?: ReadonlyMap<string, string> } {
  if (replacements.length === 0) return { ok: true, bytes: original, changed: 0 };
  let before: ParsedMap;
  let doc: OcdDocument;
  try {
    before = readOcd(original);
    doc = parseOcdDocument(original);
  } catch (error) {
    return { ok: false, message: error instanceof MapFileError ? error.message : "OCAD-filen går inte att läsa." };
  }
  let stats: OcdSymbolMutationStats;
  try {
    stats = applyOcdNormSymbols(doc, replacements);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Normens symboler kunde inte skrivas." };
  }
  if (stats.changed === 0) return { ok: true, bytes: original, changed: 0, symbolIdMap: stats.symbolIdMap };
  const packed = packOcdDocument(doc);
  const verified = verifyOcdDocument(packed.bytes, { exactObjects: before.objects.length });
  if (!verified.ok) return { ok: false, message: verified.message };
  if (verified.map.scale !== before.scale) {
    return { ok: false, message: "Kontrollen efter OCAD-normsymbolerna: kartskalan ändrades oväntat." };
  }
  return { ok: true, bytes: packed.bytes, changed: stats.changed, symbolIdMap: stats.symbolIdMap };
}

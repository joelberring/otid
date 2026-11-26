/**
 * Färgtabell (`si_Color` typ 9), dekorfärger (`si_SpotColor` typ 10) och georeferens (`si_ScalePar` typ 1039)
 * för `OcdDocument` (OCAD 9–2018+).
 *
 * I OCAD identifieras färger av stabila färgnummer (`\tn<id>`), medan färgernas ordning i filen bestäms av ordningen på
 * `si_Color`-strängarna (rank 0 överst). Därför kan färger läggas in eller flyttas utan att några symboler behöver skrivas om.
 */
import { clamp01, rgbFromCmyk } from "../../color";
import { MapFileError, type MapColor, type MapGeoreference, type ParsedMap } from "../../model";
import type { MapColorChange, MapColorsResult } from "../../revision/colors";
import { Bytes } from "../bytes";
import { AREA, ELEMENT, LINE, POINT, RECTANGLE, SYMBOL_TYPE, TEXT } from "../layout";
import { readOcd } from "../read";
import { readColors } from "../strings";
import { decodeOcdString, encodeOcdString, parseOcdDocument, type OcdDocument, type RawOcdString } from "./ocd-document";
import { packOcdDocument, verifyOcdDocument } from "./ocd-pack";

export const STRING_TYPE = {
  template: 8,
  color: 9,
  spotColor: 10,
  scalePar: 1039
} as const;

export interface OcdColorUpdate {
  readonly kind?: "update" | undefined;
  readonly id: number;
  readonly cmyk?: MapColor["cmyk"] | undefined;
  readonly name?: string | undefined;
  readonly overprint?: boolean | undefined;
  readonly opacity?: number | undefined;
  /** `null` tar bort dekorfärgsseparationer (`\ts`/`\tp`); utelämnat bevarar befintliga. */
  readonly spot?: MapColor["spot"] | null | undefined;
}

export interface OcdColorAdd {
  readonly kind: "add";
  /** Önskat färgnummer; utelämnat ger nästa lediga nummer (`>= 1`). */
  readonly id?: number | undefined;
  readonly name: string;
  readonly cmyk: MapColor["cmyk"];
  readonly overprint?: boolean | undefined;
  readonly opacity?: number | undefined;
  /** Färgnummer att lägga den nya färgen ovanför i ritordningen (utelämnat = sist). */
  readonly beforeId?: number | undefined;
  readonly spot?: MapColor["spot"] | undefined;
}

export interface OcdColorMove {
  readonly kind: "move";
  readonly id: number;
  /** Färgnummer att flytta färgen ovanför (`null`/`undefined` = sist). */
  readonly beforeId?: number | null | undefined;
}

export interface OcdColorDelete {
  readonly kind: "delete";
  readonly id: number;
}

/** Supermängd av `MapColorChange`: ett vanligt `{ id, cmyk }` fungerar rakt av som en uppdatering. */
export type OcdColorEdit = OcdColorUpdate | OcdColorAdd | OcdColorMove | OcdColorDelete;

export interface OcdColorApplyStats {
  readonly changed: number;
  /** Färgnamn/nyckel → tilldelat färgnummer för tillagda färger (i ordning). */
  readonly addedIds: readonly number[];
}

interface ParsedFields {
  first: string;
  pairs: [string, string][];
}

function parseTabFields(value: string): ParsedFields {
  const parts = value.split("\t");
  const pairs: [string, string][] = [];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.length > 0) pairs.push([part[0]!, part.slice(1)]);
  }
  return { first: parts[0] ?? "", pairs };
}

function serializeTabFields(fields: ParsedFields): string {
  return [fields.first, ...fields.pairs.map(([k, v]) => `${k}${v}`)].join("\t");
}

function getFieldNumber(pairs: readonly [string, string][], key: string): number | undefined {
  const found = pairs.find(([k]) => k === key);
  if (!found) return undefined;
  const value = Number(found[1].trim());
  return Number.isFinite(value) ? value : undefined;
}

function setOrAppendField(pairs: [string, string][], key: string, value: string): void {
  const idx = pairs.findIndex(([k]) => k === key);
  if (idx >= 0) pairs[idx] = [key, value];
  else pairs.push([key, value]);
}

function removeFields(pairs: [string, string][], keys: ReadonlySet<string>): [string, string][] {
  return pairs.filter(([k]) => !keys.has(k));
}

/** Formaterar 0..1 som OCAD-procent 0..100 med högst två decimaler utan onödiga nollor (t.ex. `0`, `13.5`, `100`). */
function formatPercent(value01: number): string {
  const pct = Math.round(clamp01(value01) * 10000) / 100;
  return String(pct === 0 ? 0 : pct);
}

/** Formaterar 0..1 som 1-decimalsprocent för `si_SpotColor` (som OCAD skriver: `87.0`, `18.5`). */
function formatSpotPercent(value01: number): string {
  return (Math.round(clamp01(value01) * 1000) / 10).toFixed(1);
}

const sanitizeName = (name: string): string => name.replace(/[\t\r\n\0]/g, " ").trim() || "Färg";
const closeCmyk = (a: number, b: number) => Math.abs(a - b) < 0.0006;
const sameCmyk = (a: MapColor["cmyk"], b: MapColor["cmyk"]) =>
  closeCmyk(a.c, b.c) && closeCmyk(a.m, b.m) && closeCmyk(a.y, b.y) && closeCmyk(a.k, b.k);

/** Läser färgtabellen ur ett `OcdDocument` med exakt samma tolkning som `readOcd()`. */
export function documentColors(doc: OcdDocument): MapColor[] {
  const params = doc.strings
    .filter(s => s.recType === STRING_TYPE.color || s.recType === STRING_TYPE.spotColor)
    .map(s => ({ type: s.recType, value: decodeOcdString(s.raw) }));
  return readColors(params);
}

/** Samlar alla färgnummer som används av symbolerna i ett `OcdDocument` (så använda färger inte raderas). */
export function collectDocumentUsedColorIds(doc: OcdDocument): Set<number> {
  const used = new Set<number>();
  const shift = doc.variant.symbolBody - 796;
  for (const sym of doc.symbols) {
    const bytes = new Bytes(sym.bytes);
    const at = shift;
    const end = sym.bytes.length;
    const add = (color: number) => { if (color >= 0) used.add(color); };
    const scanElements = (start: number, words: number) => {
      const stop = Math.min(end, start + words * 8);
      let pos = start;
      while (pos + ELEMENT.header <= stop) {
        add(bytes.u16(pos + ELEMENT.color));
        const count = bytes.u16(pos + ELEMENT.coordCount);
        pos += ELEMENT.header + count * 8;
      }
    };
    if (sym.type === SYMBOL_TYPE.point && at + POINT.elements <= end) {
      scanElements(at + POINT.elements, bytes.u16(at + POINT.dataSize));
    } else if (sym.type === SYMBOL_TYPE.line && at + LINE.elements <= end) {
      if (bytes.i16(at + LINE.width) > 0) add(bytes.i16(at + LINE.color));
      if (bytes.i16(at + LINE.framingWidth) > 0) add(bytes.i16(at + LINE.framingColor));
      const dblMode = bytes.u16(at + LINE.doubleMode);
      if (dblMode !== 0) {
        if ((bytes.u16(at + LINE.doubleFlags) & 1) !== 0 && bytes.i16(at + LINE.doubleWidth) > 0) add(bytes.i16(at + LINE.doubleColor));
        if (bytes.i16(at + LINE.doubleLeftWidth) > 0) add(bytes.i16(at + LINE.doubleLeftColor));
        if (bytes.i16(at + LINE.doubleRightWidth) > 0) add(bytes.i16(at + LINE.doubleRightColor));
      }
      let pos = at + LINE.elements;
      for (const offset of [LINE.primaryDataSize, LINE.secondaryDataSize, LINE.cornerDataSize, LINE.startDataSize, LINE.endDataSize]) {
        const words = bytes.u16(at + offset);
        if (words > 0) scanElements(pos, words);
        pos += words * 8;
      }
    } else if (sym.type === SYMBOL_TYPE.area && at + doc.variant.areaData.elements <= end) {
      if (bytes.u8(at + AREA.fillOn) !== 0) add(bytes.u16(at + AREA.fillColor));
      const hatchMode = bytes.u16(at + AREA.hatchMode);
      if (hatchMode === 1 || hatchMode === 2) add(bytes.u16(at + AREA.hatchColor));
      const structMode = bytes.u8(at + AREA.structureMode);
      if (structMode === 1 || structMode === 2) {
        scanElements(at + doc.variant.areaData.elements, bytes.u16(at + doc.variant.areaData.dataSize));
      }
    } else if ((sym.type === SYMBOL_TYPE.text || sym.type === SYMBOL_TYPE.lineText) && at + TEXT.color + 2 <= end) {
      add(bytes.u16(at + TEXT.color));
      if (sym.type === SYMBOL_TYPE.text && at + TEXT.framingEnd <= end && bytes.u8(at + TEXT.frMode) === 2) {
        add(bytes.i16(at + TEXT.frColor));
      }
    } else if (sym.type === SYMBOL_TYPE.rectangle && at + RECTANGLE.width + 2 <= end) {
      add(bytes.u16(at + RECTANGLE.color));
    }
  }
  return used;
}

/** Säkerställer att varje dekorfärgsnamn i `spot.separations` finns som `si_SpotColor` (typ 10). */
function ensureSpotColorStrings(doc: OcdDocument, spot: NonNullable<MapColor["spot"]>): void {
  const separations = spot.separations;
  if (!separations || separations.length === 0) return;
  const existingNames = new Set<string>();
  let maxSpotIndex = -1;
  let lastSpotStringIdx = -1;
  doc.strings.forEach((entry, idx) => {
    if (entry.recType !== STRING_TYPE.spotColor) return;
    lastSpotStringIdx = idx;
    const parsed = parseTabFields(decodeOcdString(entry.raw));
    existingNames.add(parsed.first);
    const n = getFieldNumber(parsed.pairs, "n");
    if (n !== undefined && n > maxSpotIndex) maxSpotIndex = n;
  });

  const additions: RawOcdString[] = [];
  for (const sep of separations) {
    const cleanName = sanitizeName(sep.name);
    if (!cleanName || existingNames.has(cleanName)) continue;
    existingNames.add(cleanName);
    maxSpotIndex += 1;
    const cmyk = sep.cmyk ?? { c: 0, m: 0, y: 0, k: 1 };
    const value = [
      cleanName,
      `n${maxSpotIndex}`,
      "v1",
      `c${formatSpotPercent(cmyk.c)}`,
      `m${formatSpotPercent(cmyk.m)}`,
      `y${formatSpotPercent(cmyk.y)}`,
      `k${formatSpotPercent(cmyk.k)}`,
      "f1500.0",
      "a45.0"
    ].join("\t");
    additions.push({ recType: STRING_TYPE.spotColor, raw: encodeOcdString(value, doc.version), objKey: null });
  }
  if (additions.length === 0) return;
  if (lastSpotStringIdx >= 0) {
    doc.strings.splice(lastSpotStringIdx + 1, 0, ...additions);
  } else {
    const firstColorIdx = doc.strings.findIndex(s => s.recType === STRING_TYPE.color);
    doc.strings.splice(firstColorIdx >= 0 ? firstColorIdx : 0, 0, ...additions);
  }
}

function buildNewColorString(id: number, edit: OcdColorAdd, version: number): RawOcdString {
  const pairs: [string, string][] = [
    ["n", String(id)],
    ["c", formatPercent(edit.cmyk.c)],
    ["m", formatPercent(edit.cmyk.m)],
    ["y", formatPercent(edit.cmyk.y)],
    ["k", formatPercent(edit.cmyk.k)],
    ["o", edit.overprint || edit.spot?.overprint ? "1" : "0"],
    ["t", formatPercent(edit.opacity ?? 1)]
  ];
  if (edit.spot?.separations) {
    for (const sep of edit.spot.separations) {
      pairs.push(["s", sanitizeName(sep.name)], ["p", formatPercent(sep.factor)]);
    }
  }
  const value = serializeTabFields({ first: sanitizeName(edit.name), pairs });
  return { recType: STRING_TYPE.color, raw: encodeOcdString(value, version), objKey: null };
}

/**
 * Applicerar färgändringar (`update`, `add`, `move`, `delete`) direkt på `doc.strings` (`si_Color` & `si_SpotColor`).
 * Orörda `si_Color`-strängar och okända fält (t.ex. `\tbDarken`, `\ts`/`\tp`) bevaras förlustfritt.
 */
export function applyOcdColors(doc: OcdDocument, edits: readonly OcdColorEdit[]): OcdColorApplyStats {
  if (edits.length === 0) return { changed: 0, addedIds: [] };

  // Samla alla `si_Color`-poster i sin ursprungliga ordning (rank 0 först) och kom ihåg var blocket börjar.
  interface ColorSlot {
    id: number;
    entry: RawOcdString;
    dirty: boolean;
  }
  const firstColorPos = doc.strings.findIndex(s => s.recType === STRING_TYPE.color);
  const usedIds = new Set<number>();
  const colorList: ColorSlot[] = [];
  for (const entry of doc.strings) {
    if (entry.recType !== STRING_TYPE.color) continue;
    const parsed = parseTabFields(decodeOcdString(entry.raw));
    let id = getFieldNumber(parsed.pairs, "n") ?? colorList.length;
    if (usedIds.has(id)) id = Math.max(...usedIds) + 1;
    usedIds.add(id);
    colorList.push({ id, entry, dirty: false });
  }

  let changed = 0;
  const addedIds: number[] = [];
  let cachedUsedInSymbols: Set<number> | null = null;

  for (const edit of edits) {
    const kind = edit.kind ?? "update";
    if (kind === "add") {
      const addEdit = edit as OcdColorAdd;
      let id = addEdit.id !== undefined && Number.isInteger(addEdit.id) && addEdit.id >= 0 && !usedIds.has(addEdit.id)
        ? addEdit.id
        : Math.max(0, ...usedIds) + 1;
      while (usedIds.has(id)) id += 1;
      usedIds.add(id);
      if (addEdit.spot) ensureSpotColorStrings(doc, addEdit.spot);
      const entry = buildNewColorString(id, addEdit, doc.version);
      const slot: ColorSlot = { id, entry, dirty: true };
      const beforeIdx = addEdit.beforeId !== undefined ? colorList.findIndex(row => row.id === addEdit.beforeId) : -1;
      if (beforeIdx >= 0) colorList.splice(beforeIdx, 0, slot);
      else colorList.push(slot);
      addedIds.push(id);
      changed += 1;
      continue;
    }

    if (kind === "move") {
      const moveEdit = edit as OcdColorMove;
      const fromIdx = colorList.findIndex(row => row.id === moveEdit.id);
      if (fromIdx < 0) continue;
      const [item] = colorList.splice(fromIdx, 1);
      if (!item) continue;
      const targetIdx = moveEdit.beforeId !== undefined && moveEdit.beforeId !== null
        ? colorList.findIndex(row => row.id === moveEdit.beforeId)
        : -1;
      const insertAt = targetIdx >= 0 ? targetIdx : colorList.length;
      colorList.splice(insertAt, 0, item);
      if (insertAt !== fromIdx) changed += 1;
      continue;
    }

    if (kind === "delete") {
      const delEdit = edit as OcdColorDelete;
      const idx = colorList.findIndex(row => row.id === delEdit.id);
      if (idx < 0) continue;
      if (cachedUsedInSymbols === null) cachedUsedInSymbols = collectDocumentUsedColorIds(doc);
      if (cachedUsedInSymbols.has(delEdit.id)) continue;
      colorList.splice(idx, 1);
      usedIds.delete(delEdit.id);
      changed += 1;
      continue;
    }

    // kind === "update" (inkl. standard `MapColorChange`)
    const upd = edit as OcdColorUpdate;
    const slot = colorList.find(row => row.id === upd.id);
    if (!slot) continue;
    const parsed = parseTabFields(decodeOcdString(slot.entry.raw));
    let modified = false;

    if (upd.name !== undefined) {
      const clean = sanitizeName(upd.name);
      if (clean !== parsed.first) { parsed.first = clean; modified = true; }
    }
    if (upd.cmyk !== undefined) {
      const cur = {
        c: clamp01((getFieldNumber(parsed.pairs, "c") ?? 0) / 100),
        m: clamp01((getFieldNumber(parsed.pairs, "m") ?? 0) / 100),
        y: clamp01((getFieldNumber(parsed.pairs, "y") ?? 0) / 100),
        k: clamp01((getFieldNumber(parsed.pairs, "k") ?? 0) / 100)
      };
      const next = { c: clamp01(upd.cmyk.c), m: clamp01(upd.cmyk.m), y: clamp01(upd.cmyk.y), k: clamp01(upd.cmyk.k) };
      if (!sameCmyk(cur, next)) {
        setOrAppendField(parsed.pairs, "c", formatPercent(next.c));
        setOrAppendField(parsed.pairs, "m", formatPercent(next.m));
        setOrAppendField(parsed.pairs, "y", formatPercent(next.y));
        setOrAppendField(parsed.pairs, "k", formatPercent(next.k));
        modified = true;
      }
    }
    if (upd.overprint !== undefined) {
      const want = upd.overprint ? "1" : "0";
      const cur = getFieldNumber(parsed.pairs, "o") === 1 ? "1" : "0";
      if (want !== cur) { setOrAppendField(parsed.pairs, "o", want); modified = true; }
    }
    if (upd.opacity !== undefined) {
      const want = formatPercent(upd.opacity);
      const curVal = getFieldNumber(parsed.pairs, "t");
      const cur = curVal === undefined ? "100" : String(curVal);
      if (want !== cur) { setOrAppendField(parsed.pairs, "t", want); modified = true; }
    }
    if (upd.spot !== undefined) {
      parsed.pairs = removeFields(parsed.pairs, new Set(["s", "p"]));
      if (upd.spot) {
        ensureSpotColorStrings(doc, upd.spot);
        if (upd.spot.separations) {
          for (const sep of upd.spot.separations) {
            parsed.pairs.push(["s", sanitizeName(sep.name)], ["p", formatPercent(sep.factor)]);
          }
        }
        setOrAppendField(parsed.pairs, "o", upd.spot.overprint ? "1" : "0");
      }
      modified = true;
    }

    if (modified) {
      slot.entry = { recType: STRING_TYPE.color, raw: encodeOcdString(serializeTabFields(parsed), doc.version), objKey: null };
      slot.dirty = true;
      changed += 1;
    }
  }

  if (changed === 0) return { changed: 0, addedIds: [] };

  // Återmontera `doc.strings`: bevara alla icke-färgsträngar på sina platser och lägg de ordnade `si_Color`-strängarna samlat.
  const nonColors: RawOcdString[] = [];
  let insertAt = -1;
  for (let i = 0; i < doc.strings.length; i++) {
    const entry = doc.strings[i]!;
    if (entry.recType === STRING_TYPE.color) {
      if (insertAt < 0) insertAt = nonColors.length;
      continue;
    }
    nonColors.push(entry);
  }
  if (insertAt < 0) {
    const lastSpot = nonColors.reduce((acc, s, idx) => (s.recType === STRING_TYPE.spotColor ? idx : acc), -1);
    insertAt = lastSpot >= 0 ? lastSpot + 1 : (firstColorPos >= 0 ? Math.min(firstColorPos, nonColors.length) : nonColors.length);
  }
  nonColors.splice(insertAt, 0, ...colorList.map(slot => slot.entry));
  doc.strings = nonColors;
  return { changed, addedIds };
}

/**
 * Uppdaterar eller skapar `si_ScalePar` (typ 1039) i `OcdDocument` för skala och georeferens.
 * Bevarar befintliga okända fält (t.ex. `\tg` rutnätsavstånd, `\td`, `\tb`, `\tc`).
 */
export function updateOcdScalePar(doc: OcdDocument, georeference: MapGeoreference | null, scaleOverride?: number): void {
  const existingIdx = doc.strings.findIndex(s => s.recType === STRING_TYPE.scalePar);
  const parsed: ParsedFields = existingIdx >= 0
    ? parseTabFields(decodeOcdString(doc.strings[existingIdx]!.raw))
    : {
        first: "",
        pairs: [
          ["m", "10000.000000"],
          ["g", "500.0000"],
          ["r", "0"],
          ["x", "0"],
          ["y", "0"],
          ["a", "0.00000000"],
          ["d", "1000.00"],
          ["b", "0.00"],
          ["c", "0.00"]
        ]
      };

  const scale = scaleOverride ?? georeference?.scale;
  if (scale !== undefined && Number.isFinite(scale) && scale > 0) {
    setOrAppendField(parsed.pairs, "m", scale.toFixed(6));
  }

  if (georeference) {
    setOrAppendField(parsed.pairs, "r", "1");
    setOrAppendField(parsed.pairs, "x", String(Math.round(georeference.refPoint.easting * 100) / 100));
    setOrAppendField(parsed.pairs, "y", String(Math.round(georeference.refPoint.northing * 100) / 100));
    setOrAppendField(parsed.pairs, "a", georeference.grivationDegrees.toFixed(8));
    if (georeference.crs.kind === "EPSG") {
      setOrAppendField(parsed.pairs, "e", String(georeference.crs.code));
      if (georeference.crs.code === 3006) {
        setOrAppendField(parsed.pairs, "i", "13002");
      } else {
        // Behåll bara `i` om det inte var SWEREF-koden 13002 för ett annat EPSG.
        if (getFieldNumber(parsed.pairs, "i") === 13002) {
          parsed.pairs = removeFields(parsed.pairs, new Set(["i"]));
        }
      }
    }
  } else {
    setOrAppendField(parsed.pairs, "r", "0");
  }

  const next: RawOcdString = { recType: STRING_TYPE.scalePar, raw: encodeOcdString(serializeTabFields(parsed), doc.version), objKey: null };
  if (existingIdx >= 0) doc.strings[existingIdx] = next;
  else doc.strings.push(next);
}

const fingerprint = (map: ParsedMap) => JSON.stringify([[...map.symbols.values()], map.objects.length, map.scale]);

/**
 * Dropp-in för `revision/colors.ts`: applicerar `MapColorChange[]` (inkl. dekorfärger!) på en OCAD-fil, packar
 * deterministiskt och verifierar att endast färgerna ändrats.
 */
export function applyOcdColorChanges(original: Uint8Array, changes: readonly MapColorChange[]): MapColorsResult {
  if (changes.length === 0) return { ok: true, bytes: original, changed: 0 };
  let before: ParsedMap;
  let doc: OcdDocument;
  try {
    before = readOcd(original);
    doc = parseOcdDocument(original);
  } catch (error) {
    return { ok: false, message: error instanceof MapFileError ? error.message : "OCAD-filen går inte att läsa." };
  }

  // Filtrera effektiva ändringar (stödjer både process- och dekorfärger!).
  const effective = new Map<number, MapColorChange>();
  for (const change of changes) {
    const existing = before.colors.find(color => color.id === change.id);
    if (!existing) continue;
    const tidy = { c: clamp01(change.cmyk.c), m: clamp01(change.cmyk.m), y: clamp01(change.cmyk.y), k: clamp01(change.cmyk.k) };
    if (sameCmyk(existing.cmyk, tidy)) continue;
    effective.set(change.id, { id: change.id, cmyk: tidy });
  }
  if (effective.size === 0) return { ok: true, bytes: original, changed: 0 };

  const stats = applyOcdColors(doc, [...effective.values()]);
  if (stats.changed === 0) return { ok: true, bytes: original, changed: 0 };

  const packed = packOcdDocument(doc);
  const verified = verifyOcdDocument(packed.bytes, { exactObjects: before.objects.length });
  if (!verified.ok) return { ok: false, message: verified.message };
  const after = verified.map;

  const expectedColors = before.colors.map(color => {
    const edit = effective.get(color.id);
    return edit ? { ...color, cmyk: edit.cmyk, rgb: rgbFromCmyk(edit.cmyk) } : color;
  });
  const colorsOk = after.colors.length === expectedColors.length && after.colors.every((color, i) => {
    const want = expectedColors[i]!;
    return color.id === want.id && color.name === want.name && color.opacity === want.opacity
      && sameCmyk(color.cmyk, want.cmyk)
      && (effective.has(color.id) || JSON.stringify(color) === JSON.stringify(want));
  });
  if (!colorsOk || fingerprint(after) !== fingerprint(before)) {
    return { ok: false, message: "Kontrollen efter OCAD-färgbytet: något annat än färgerna ändrades." };
  }
  return { ok: true, bytes: packed.bytes, changed: stats.changed };
}

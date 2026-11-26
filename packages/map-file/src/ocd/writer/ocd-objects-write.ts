/**
 * Objektrevidering på `OcdDocument` samt komplett enkelpass-pipeline `applyOcdFullRevision()`.
 *
 * Återanvänder all härdad Steg 1-logik (`ocd-record.ts`) — men med full kompaktering och `TStringIndex.ObjIndex`-ommappning
 * så även objekt med länkade parametersträngar kan ändras eller raderas säkert!
 */
import { normalizeAngle, openRing } from "../../geometry";
import { MapFileError, type MapGeoreference, type MapObject, type MapSymbol, type ParsedMap } from "../../model";
import {
  findConflicts, type AddChange, type MapRevisionApplyResult, type MapRevisionChangeSet, type MapRevisionRefusal,
  type ModifyChange, type OcdObjectLocator
} from "../../revision/change-set";
import { checkGeometry, GeometryError } from "../../revision/geometry";
import { sameOcdObject } from "../../revision/ocd-verify";
import { ocdPoints } from "../../revision/ocd-write";
import { stripSource, symbolObjectKind, withGeometry } from "../../revision/omap-write";
import { sha256Hex } from "../../revision/sha256";
import type { MapSymbolColorChange } from "../../revision/symbol-colors";
import type { SymbolReplacement } from "../../revision/symbol-replace";
import type { MapTextSymbolChange } from "../../revision/text-symbols";
import { WarningCollector } from "../../warnings";
import { Bytes } from "../bytes";
import { OBJECT_TYPE, STATUS_NORMAL, type OcdVariant } from "../layout";
import { readOcd } from "../read";
import { readOcdSymbols } from "../symbols";
import { applyOcdColors, updateOcdScalePar, type OcdColorEdit } from "./ocd-colors-write";
import { OBJ_INDEX, OBJ_STATUS, parseOcdDocument, type OcdDocument, type RawOcdObject } from "./ocd-document";
import { packOcdDocument, verifyOcdDocument } from "./ocd-pack";
import {
  angleUnits, buildOcdObjectRecord, computeOcdObjectRect, encodeOcdTextBytes, keepOriginalFlags, MAX_TEXT_WORDS,
  OCD_COORD_LIMIT, ocdUnit, readRawObjectPoints, symbolPrimaryColor, textBoxPoints, V12_OBJ, V9_OBJ, type RawPt
} from "./ocd-record";
import { applyOcdNormSymbols, applyOcdSymbolColors, applyOcdTextSymbols } from "./ocd-symbols-write";

export interface ExpectedDocObject {
  readonly key: number;
  readonly object: MapObject | null;
  readonly type?: number | undefined;
}

export type ApplyDocRevisionResult =
  | {
      readonly ok: true;
      readonly modified: number;
      readonly added: number;
      readonly deleted: number;
      readonly addedKeys: readonly { readonly id: string; readonly key: number }[];
      readonly modifiedKeys: readonly number[];
      readonly expected: readonly ExpectedDocObject[];
    }
  | { readonly ok: false; readonly refusals: readonly MapRevisionRefusal[] };

export interface OcdFullRevisionOptions {
  readonly colors?: readonly OcdColorEdit[] | undefined;
  readonly symbolColors?: readonly MapSymbolColorChange[] | undefined;
  readonly textSymbols?: readonly MapTextSymbolChange[] | undefined;
  readonly normAdditions?: readonly SymbolReplacement[] | undefined;
  readonly normReplacements?: readonly SymbolReplacement[] | undefined;
  readonly georeference?: MapGeoreference | null | undefined;
  readonly scale?: number | undefined;
}

const refuse = (code: MapRevisionRefusal["code"], message: string, change?: number): { readonly ok: false; readonly refusals: readonly MapRevisionRefusal[] } =>
  ({ ok: false, refusals: [{ code, message, ...(change !== undefined ? { change } : {}) }] });

function symbolNumberOf(id: string): number | undefined {
  const value = Number(id);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function objectTypeOf(kind: MapObject["kind"]): number {
  return kind === "point" ? OBJECT_TYPE.point : kind === "line" ? OBJECT_TYPE.line : kind === "area" ? OBJECT_TYPE.area : OBJECT_TYPE.text;
}

/** Läser aktuell symboltabell ur `doc` (inkl. ev. nytillagda text- och normsymboler). */
function readCurrentDocSymbols(doc: OcdDocument): Map<string, MapSymbol> {
  if (doc.symbols.length === 0) return new Map();
  const start = 8; // Offset 0 betyder "inget symbolblock" i `readOcdSymbols`.
  const blockCount = Math.ceil(doc.symbols.length / 256);
  const blockSize = 4 + 256 * 4;
  let total = start + blockCount * blockSize;
  for (const s of doc.symbols) total += s.bytes.length;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  let cursor = start + blockCount * blockSize;
  for (let b = 0; b < blockCount; b++) {
    const blockAt = start + b * blockSize;
    view.setUint32(blockAt, b + 1 < blockCount ? start + (b + 1) * blockSize : 0, true);
    const end = Math.min(doc.symbols.length, (b + 1) * 256);
    for (let i = b * 256; i < end; i++) {
      const s = doc.symbols[i]!;
      view.setInt32(blockAt + 4 + (i - b * 256) * 4, cursor, true);
      buf.set(s.bytes, cursor);
      cursor += s.bytes.length;
    }
  }
  return readOcdSymbols(new Bytes(buf), start, new WarningCollector(), doc.variant);
}

/** Applicerar objektändringar (add/modify/delete) direkt på ett `OcdDocument` (med valfri symbol-id-ommappning). */
export function applyOcdRevisionToDocument(
  doc: OcdDocument,
  sourceMap: ParsedMap,
  changeSet: MapRevisionChangeSet,
  symbolIdMap?: ReadonlyMap<string, string>
): ApplyDocRevisionResult {
  const symbols = readCurrentDocSymbols(doc);
  const remapSym = (id: string) => symbolIdMap?.get(id) ?? id;

  const rawBySlot = new Map<string, RawOcdObject>();
  for (const obj of doc.objects) {
    if (obj.originalLocator) rawBySlot.set(`${obj.originalLocator.block}:${obj.originalLocator.slot}`, obj);
  }
  const mapObjBySlot = new Map<string, MapObject>();
  for (const obj of sourceMap.objects) {
    const loc = obj.source?.locator;
    if (loc?.format === "OCD") mapObjBySlot.set(`${loc.block}:${loc.slot}`, obj);
  }
  const templateBySym = new Map<number, RawOcdObject>();
  for (const obj of doc.objects) {
    if (obj.status === OBJ_STATUS.normal && obj.symbol > 0 && !obj.encrypted && !templateBySym.has(obj.symbol)) {
      templateBySym.set(obj.symbol, obj);
    }
  }

  const locate = (ref: ModifyChange["ref"], changeIdx: number): { raw: RawOcdObject; mapObj: MapObject } | { ok: false; refusals: readonly MapRevisionRefusal[] } => {
    if (ref.fileSha256 !== changeSet.baseFileSha256 || ref.locator.format !== "OCD") {
      return refuse("OBJECT_MISMATCH", "Ändringen gäller en annan fil.", changeIdx);
    }
    const slotKey = `${ref.locator.block}:${ref.locator.slot}`;
    const raw = rawBySlot.get(slotKey);
    const mapObj = mapObjBySlot.get(slotKey);
    if (!raw || !mapObj || raw.originalLocator?.offset !== ref.locator.offset) {
      return refuse("OBJECT_MISMATCH", "Objektet finns inte på sin plats i filen.", changeIdx);
    }
    if (sha256Hex(raw.record, 0, raw.record.length) !== ref.objectHash) {
      return refuse("OBJECT_MISMATCH", "Objektet har ändrats i filen sedan ändringen gjordes.", changeIdx);
    }
    if (raw.encrypted) return refuse("UNSAFE_FILE", "Objektet är krypterat.", changeIdx);
    const view = new DataView(raw.record.buffer, raw.record.byteOffset, raw.record.byteLength);
    if (doc.variant.version >= 12 && (view.getUint16(V12_OBJ.objectStrings, true) !== 0 || view.getUint16(V12_OBJ.databaseStrings, true) !== 0)) {
      return refuse("UNSAFE_FILE", "Objekt med inbäddade objekt- eller databassträngar ändras inte här.", changeIdx);
    }
    if (doc.variant.version >= 10 && doc.variant.version < 12 && view.getUint16(V9_OBJ.objectStrings, true) !== 0) {
      return refuse("UNSAFE_FILE", "Objekt med inbäddade objektsträngar ändras inte här.", changeIdx);
    }
    return { raw, mapObj };
  };

  type PlannedTarget =
    | { readonly kind: "delete"; readonly raw: RawOcdObject }
    | { readonly kind: "modify"; readonly raw: RawOcdObject; readonly record: Uint8Array; readonly indexEntry: Uint8Array; readonly symbol: number; readonly type: number; readonly object: MapObject };

  const targets = new Map<number, PlannedTarget>();
  const additions: { readonly id: string; readonly raw: RawOcdObject; readonly object: MapObject }[] = [];

  for (let i = 0; i < changeSet.changes.length; i++) {
    const change = changeSet.changes[i]!;
    if (change.kind === "delete") {
      const found = locate(change.ref, i);
      if ("ok" in found) return found;
      targets.set(found.raw.key, { kind: "delete", raw: found.raw });
      continue;
    }
    if (change.kind === "modify") {
      const found = locate(change.ref, i);
      if ("ok" in found) return found;
      const mappedChange: ModifyChange = change.symbol !== undefined ? { ...change, symbol: remapSym(change.symbol) } : change;
      const built = buildModifiedObject(doc.variant, found.raw, found.mapObj, mappedChange, i, symbols, templateBySym);
      if ("ok" in built) return built;
      targets.set(found.raw.key, { kind: "modify", raw: found.raw, ...built });
      continue;
    }
    const mappedAdd: AddChange = { ...change, symbol: remapSym(change.symbol) };
    const built = buildAddedObject(doc.variant, doc.nextObjectKey, mappedAdd, i, symbols, templateBySym);
    if ("ok" in built) return built;
    doc.nextObjectKey += 1;
    additions.push({ id: change.id, raw: built.raw, object: built.object });
  }

  let modified = 0, deleted = 0;
  const deletedKeys = new Set<number>();
  const modifiedKeys: number[] = [];
  const expected: ExpectedDocObject[] = [];

  for (const target of targets.values()) {
    if (target.kind === "delete") {
      deletedKeys.add(target.raw.key);
      expected.push({ key: target.raw.key, object: null });
      deleted += 1;
    } else {
      target.raw.record = target.record;
      target.raw.indexEntry = target.indexEntry;
      target.raw.symbol = target.symbol;
      target.raw.type = target.type;
      modifiedKeys.push(target.raw.key);
      expected.push({ key: target.raw.key, object: target.object, type: target.type });
      modified += 1;
    }
  }
  if (deletedKeys.size > 0) doc.objects = doc.objects.filter(obj => !deletedKeys.has(obj.key));

  const addedKeys: { id: string; key: number }[] = [];
  for (const item of additions) {
    doc.objects.push(item.raw);
    addedKeys.push({ id: item.id, key: item.raw.key });
    expected.push({ key: item.raw.key, object: item.object, type: item.raw.type });
  }
  return { ok: true, modified, added: additions.length, deleted, addedKeys, modifiedKeys, expected };
}

function buildModifiedObject(
  variant: OcdVariant, rawObj: RawOcdObject, original: MapObject, change: ModifyChange, changeIdx: number,
  symbols: ReadonlyMap<string, MapSymbol>, templateBySym: ReadonlyMap<number, RawOcdObject>
): { record: Uint8Array; indexEntry: Uint8Array; symbol: number; type: number; object: MapObject } | { ok: false; refusals: readonly MapRevisionRefusal[] } {
  const layout = variant.object;
  const recView = new DataView(rawObj.record.buffer, rawObj.record.byteOffset, rawObj.record.byteLength);
  const header = rawObj.record.slice(0, layout.coords);
  const originalType = recView.getUint8(layout.type);
  const count = recView.getUint32(layout.coordCount, true);
  const textWords = recView.getUint16(layout.textCount, true);
  const rawPts = readRawObjectPoints(rawObj.record, layout.coords, count);
  let textData: Uint8Array = rawObj.record.slice(layout.coords + count * 8, layout.coords + (count + textWords) * 8);
  let object = stripSource(original);
  let symbol = recView.getInt32(0, true);
  let type = originalType;
  const indexEntry = rawObj.indexEntry.slice();
  const entryView = new DataView(indexEntry.buffer);

  if (change.symbol !== undefined && change.symbol !== original.symbol) {
    const kind = symbolObjectKind(symbols, change.symbol);
    const symNum = symbolNumberOf(change.symbol);
    if (!kind || symNum === undefined) return refuse("INVALID_CHANGE", `symbolen ${change.symbol} finns inte i kartfilen.`, changeIdx);
    if (kind !== original.kind) return refuse("INVALID_CHANGE", `symbolen ${change.symbol} passar inte objektets slag.`, changeIdx);
    const targetSym = symbols.get(change.symbol);
    if (original.kind === "text" && targetSym?.kind === "TEXT" && Boolean(targetSym.lineText) !== (originalType === OBJECT_TYPE.lineText)) {
      return refuse("INVALID_CHANGE", "kan inte byta mellan vanlig text och linjetext.", changeIdx);
    }
    if (original.kind === "line" && targetSym?.kind === "LINE") {
      if (targetSym.rectangle) type = OBJECT_TYPE.rectangle;
      else if (originalType === OBJECT_TYPE.rectangle) type = OBJECT_TYPE.line;
    }
    symbol = symNum;
    object = { ...object, symbol: change.symbol };
    const like = templateBySym.get(symNum);
    let entryColor: number;
    if (like) {
      const lv = new DataView(like.indexEntry.buffer, like.indexEntry.byteOffset, like.indexEntry.byteLength);
      entryView.setUint8(OBJ_INDEX.view, lv.getUint8(OBJ_INDEX.view));
      entryColor = lv.getInt16(OBJ_INDEX.color, true);
    } else {
      entryColor = symbolPrimaryColor(targetSym);
    }
    entryView.setInt16(OBJ_INDEX.color, entryColor, true);
    new DataView(header.buffer).setInt32(variant.version >= 12 ? V12_OBJ.color : V9_OBJ.color, entryColor, true);
  }

  let angle = recView.getInt16(layout.angle, true);
  if (change.angle !== undefined) {
    if (original.kind === "line") return refuse("INVALID_CHANGE", "en linje har ingen vinkel.", changeIdx);
    if (!Number.isFinite(change.angle)) return refuse("INVALID_CHANGE", "vinkeln är inte ett tal.", changeIdx);
    angle = angleUnits(change.angle);
    object = { ...object, angle: normalizeAngle(change.angle) } as MapObject;
  }

  let points = rawPts;
  if (change.geometry) {
    if (change.geometry.kind !== original.kind) return refuse("INVALID_CHANGE", "geometrin har fel slag för objektet.", changeIdx);
    try {
      checkGeometry(change.geometry);
      if (change.geometry.kind === "point" || change.geometry.kind === "text") {
        const anchor = originalType === OBJECT_TYPE.formattedText && rawPts.length >= 4 ? rawPts[3]! : rawPts[0]!;
        const dx = ocdUnit(change.geometry.at.x) - anchor.x, dy = ocdUnit(change.geometry.at.y) - anchor.y;
        points = rawPts.map(p => {
          const x = p.x + dx, y = p.y + dy;
          if (Math.abs(x) > OCD_COORD_LIMIT || Math.abs(y) > OCD_COORD_LIMIT) {
            throw new GeometryError("Geometrin ligger utanför det område som OCAD kan lagra.");
          }
          return { ...p, x, y };
        });
      } else {
        points = keepOriginalFlags(ocdPoints(change.geometry), rawPts);
      }
    } catch (error) {
      if (error instanceof GeometryError) return refuse("INVALID_CHANGE", error.message, changeIdx);
      throw error;
    }
    object = withGeometry(object, change.geometry);
  }

  if (change.text !== undefined) {
    if (original.kind !== "text") return refuse("INVALID_CHANGE", "bara textobjekt har text.", changeIdx);
    const normalized = change.text.replace(/\r\n?/g, "\n");
    textData = encodeOcdTextBytes(normalized);
    if (textData.length / 8 > MAX_TEXT_WORDS) return refuse("INVALID_CHANGE", "texten är för lång för OCAD.", changeIdx);
    object = { ...object, text: normalized } as MapObject;
  }

  if (originalType === OBJECT_TYPE.text && rawPts.length === 5 && object.kind === "text" &&
      (change.text !== undefined || change.angle !== undefined || change.symbol !== undefined)) {
    points = textBoxPoints(points[0]!, symbols.get(object.symbol), object.text, object.angle);
  }

  const record = buildOcdObjectRecord(variant, header, symbol, type, angle, points, textData, change.at, false);
  indexEntry.set(computeOcdObjectRect(points, symbols.get(object.symbol), object, type), OBJ_INDEX.rect);
  entryView.setInt32(OBJ_INDEX.symbol, symbol, true);
  entryView.setUint8(OBJ_INDEX.type, type);
  return { record, indexEntry, symbol, type, object };
}

function buildAddedObject(
  variant: OcdVariant, key: number, change: AddChange, changeIdx: number,
  symbols: ReadonlyMap<string, MapSymbol>, templateBySym: ReadonlyMap<number, RawOcdObject>
): { raw: RawOcdObject; object: MapObject } | { ok: false; refusals: readonly MapRevisionRefusal[] } {
  const kind = symbolObjectKind(symbols, change.symbol);
  const symNum = symbolNumberOf(change.symbol);
  if (!kind || symNum === undefined) return refuse("INVALID_CHANGE", `symbolen ${change.symbol} finns inte i kartfilen.`, changeIdx);
  if (kind !== change.geometry.kind) return refuse("INVALID_CHANGE", `symbolen ${change.symbol} passar inte geometrins slag.`, changeIdx);
  const targetSym = symbols.get(change.symbol);
  if (targetSym?.kind === "TEXT" && targetSym.lineText) {
    return refuse("INVALID_CHANGE", "linjetextsymboler stöds inte för nya textobjekt.", changeIdx);
  }
  if (change.angle !== undefined && !Number.isFinite(change.angle)) return refuse("INVALID_CHANGE", "vinkeln är inte ett tal.", changeIdx);

  let textData: Uint8Array = new Uint8Array(0);
  let normalizedText = "";
  if (change.geometry.kind === "text") {
    const rawText = change.text ?? "";
    if (!rawText.trim()) return refuse("INVALID_CHANGE", "en ny text får inte vara tom.", changeIdx);
    normalizedText = rawText.replace(/\r\n?/g, "\n");
    textData = encodeOcdTextBytes(normalizedText);
    if (textData.length / 8 > MAX_TEXT_WORDS) return refuse("INVALID_CHANGE", "texten är för lång för OCAD.", changeIdx);
  }

  const normalizedAngle = normalizeAngle(change.angle ?? 0);
  let points: RawPt[];
  try {
    checkGeometry(change.geometry);
    if (change.geometry.kind === "point") {
      points = [{ x: ocdUnit(change.geometry.at.x), y: ocdUnit(change.geometry.at.y), xf: 0, yf: 0 }];
    } else if (change.geometry.kind === "text") {
      points = textBoxPoints({ x: ocdUnit(change.geometry.at.x), y: ocdUnit(change.geometry.at.y), xf: 0, yf: 0 }, targetSym, normalizedText, normalizedAngle);
    } else {
      points = ocdPoints(change.geometry);
    }
  } catch (error) {
    if (error instanceof GeometryError) return refuse("INVALID_CHANGE", error.message, changeIdx);
    throw error;
  }

  const angle = change.geometry.kind === "line" ? 0 : angleUnits(change.angle ?? 0);
  const type = targetSym?.kind === "LINE" && targetSym.rectangle ? OBJECT_TYPE.rectangle : objectTypeOf(kind);
  const like = templateBySym.get(symNum);
  let header: Uint8Array | undefined;
  const indexEntry = new Uint8Array(OBJ_INDEX.size);
  const entryView = new DataView(indexEntry.buffer);

  if (like) {
    header = like.record.slice(0, variant.object.coords);
    if (variant.version >= 12) {
      header.fill(0, V12_OBJ.lineWidth, V12_OBJ.serverIdEnd);
      header.fill(0, V12_OBJ.multiRep, V12_OBJ.modified);
      header.fill(0, V12_OBJ.objectStrings, variant.object.coords);
    } else {
      header.fill(0, V9_OBJ.objectStrings, V9_OBJ.color);
      header.fill(0, V9_OBJ.lineWidth, variant.object.coords);
    }
    const lv = new DataView(like.indexEntry.buffer, like.indexEntry.byteOffset, like.indexEntry.byteLength);
    entryView.setUint8(OBJ_INDEX.view, lv.getUint8(OBJ_INDEX.view));
    entryView.setInt16(OBJ_INDEX.color, lv.getInt16(OBJ_INDEX.color, true), true);
  } else {
    const color = symbolPrimaryColor(targetSym);
    entryView.setInt16(OBJ_INDEX.color, color, true);
    if (color !== 0) {
      header = new Uint8Array(variant.object.coords);
      new DataView(header.buffer).setInt32(variant.version >= 12 ? V12_OBJ.color : V9_OBJ.color, color, true);
    }
  }

  const geometry = change.geometry;
  const object: MapObject = geometry.kind === "point"
    ? { kind: "point", symbol: change.symbol, at: geometry.at, angle: normalizedAngle }
    : geometry.kind === "text"
    ? { kind: "text", symbol: change.symbol, at: geometry.at, angle: normalizedAngle, text: normalizedText }
    : geometry.kind === "line"
    ? { kind: "line", symbol: change.symbol, path: geometry.path }
    : { kind: "area", symbol: change.symbol, rings: geometry.rings.map(ring => openRing(ring)), angle: normalizedAngle };

  const record = buildOcdObjectRecord(variant, header, symNum, type, angle, points, textData, change.at, true);
  indexEntry.set(computeOcdObjectRect(points, targetSym, object, type), OBJ_INDEX.rect);
  entryView.setInt32(OBJ_INDEX.symbol, symNum, true);
  entryView.setUint8(OBJ_INDEX.type, type);
  entryView.setUint8(OBJ_INDEX.status, STATUS_NORMAL);

  const raw: RawOcdObject = {
    key, originalIndex: null, originalLocator: null, indexEntry, record, symbol: symNum, type, status: OBJ_STATUS.normal, encrypted: false
  };
  return { raw, object };
}

/**
 * Fullständig enkelpass-revidering på en OCAD-fil (v9–2018+) via `OcdDocument`:
 * applicerar normtillägg → textsymboler → objektändringar → färger → symbolfärger → normutbyten → ev. georeferens,
 * packar kompakterat utan döda hål och efterkontrollerar hela resultatet.
 */
export function applyOcdFullRevision(
  original: Uint8Array,
  changeSet: MapRevisionChangeSet,
  options: OcdFullRevisionOptions = {}
): MapRevisionApplyResult {
  const baseSha = sha256Hex(original);
  if (baseSha !== changeSet.baseFileSha256) return refuse("BASE_MISMATCH", "Filen är inte grundfilen som ändringarna gjordes på.");
  if (changeSet.format !== "OCD") return refuse("BASE_MISMATCH", "Filen har inte ändringssatsens format.");
  const conflicts = findConflicts(changeSet.changes);
  if (conflicts.length > 0) {
    return {
      ok: false,
      refusals: conflicts.map(([first, second]) => ({
        code: "CONFLICT" as const,
        change: second,
        message: `Ändring ${second + 1} gäller samma objekt som ändring ${first + 1}.`
      }))
    };
  }

  let doc: OcdDocument;
  let sourceMap: ParsedMap;
  try {
    doc = parseOcdDocument(original);
    sourceMap = readOcd(original, { sources: true });
  } catch (error) {
    if (error instanceof MapFileError) {
      return refuse(error.code === "UNSUPPORTED_VERSION" ? "UNSUPPORTED_VERSION" : "UNSAFE_FILE", error.message);
    }
    throw error;
  }

  const symbolIdMap = new Map<string, string>();
  try {
    if (options.normAdditions?.length) {
      const stats = applyOcdNormSymbols(doc, [], options.normAdditions);
      for (const [k, v] of stats.symbolIdMap) symbolIdMap.set(k, v);
    }
    if (options.textSymbols?.length) {
      const stats = applyOcdTextSymbols(doc, options.textSymbols);
      for (const [k, v] of stats.symbolIdMap) symbolIdMap.set(k, v);
    }
  } catch (error) {
    return refuse("VERIFY_FAILED", error instanceof Error ? error.message : "Symboländringarna kunde inte appliceras.");
  }

  const rev = applyOcdRevisionToDocument(doc, sourceMap, changeSet, symbolIdMap);
  if (!rev.ok) return rev;

  try {
    if (options.colors?.length) applyOcdColors(doc, options.colors);
    if (options.symbolColors?.length) applyOcdSymbolColors(doc, options.symbolColors);
    if (options.normReplacements?.length) applyOcdNormSymbols(doc, options.normReplacements);
    if (options.georeference !== undefined || options.scale !== undefined) {
      updateOcdScalePar(doc, options.georeference ?? sourceMap.georeference, options.scale);
    }
  } catch (error) {
    return refuse("VERIFY_FAILED", error instanceof Error ? error.message : "Färg- eller symboländringarna kunde inte appliceras.");
  }

  const packed = packOcdDocument(doc);
  const strictRcLocators = new Set<string>();
  for (const exp of rev.expected) {
    if (exp.object === null) continue;
    const loc = packed.objectLocators.get(exp.key);
    if (loc) strictRcLocators.add(`${loc.block}:${loc.slot}`);
  }

  const expectedCount = sourceMap.objects.length - rev.deleted + rev.added;
  const verified = verifyOcdDocument(packed.bytes, { exactObjects: expectedCount, strictRcLocators });
  if (!verified.ok) return refuse("VERIFY_FAILED", verified.message);

  const afterBySlot = new Map<string, MapObject>();
  for (const obj of verified.map.objects) {
    const loc = obj.source?.locator;
    if (loc?.format === "OCD") afterBySlot.set(`${loc.block}:${loc.slot}`, obj);
  }
  for (const exp of rev.expected) {
    const loc = packed.objectLocators.get(exp.key);
    if (exp.object === null) {
      if (loc) return refuse("VERIFY_FAILED", "Ett borttaget objekt finns kvar efter kompaktering.");
      continue;
    }
    if (!loc) return refuse("VERIFY_FAILED", "Ett nytt eller ändrat objekt saknar plats efter kompaktering.");
    const actual = afterBySlot.get(`${loc.block}:${loc.slot}`);
    if (!actual || !sameOcdObject(exp.object, actual)) {
      return refuse("VERIFY_FAILED", `Objektet på block ${loc.block}, plats ${loc.slot} läses inte tillbaka som beställt.`);
    }
  }

  const addedObjects: { id: string; locator: OcdObjectLocator }[] = rev.addedKeys.map(item => ({
    id: item.id,
    locator: packed.objectLocators.get(item.key)!
  }));

  return {
    ok: true,
    bytes: packed.bytes,
    report: {
      format: "OCD",
      version: sourceMap.version,
      baseFileSha256: baseSha,
      resultSha256: sha256Hex(packed.bytes),
      modified: rev.modified,
      added: rev.added,
      deleted: rev.deleted,
      addedObjects,
      edits: [],
      verification: {
        untouchedObjects: Math.max(0, sourceMap.objects.length - rev.modified - rev.deleted),
        checkedObjects: rev.expected.length,
        identicalBytes: 0
      }
    }
  };
}

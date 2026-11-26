/**
 * Deterministisk binärpackare och efterkontroll för `OcdDocument` (OCAD 9–2018+).
 *
 * Packar om filen helt utan döda hål (motsvarande OCAD *Map → Optimize/Repair*):
 * - Skriver `TFileHeader` (60 byte i v12+, 48 byte i v9–11), `FileNamePos`/`FileNameSize` och ev. v9–11 `InfoPos`/`InfoSize`.
 * - Nollställer v12+ oompackade interna blockpekare (`MrStartBlockPos` på 48, `SketchPos` på 52) så inga pekare blir hängande.
 * - Packar symbolindexblock (256 × 4 B) + symbolposter (8-bytejusterade) och uppdaterar `TBaseSym.FilePos` (offset 20) i varje post.
 * - Packar objektindexblock (256 × 40 B) + objektposter (8-bytejusterade) och beräknar nya 1-baserade `ObjIndex` (`1..N`).
 * - Packar strängindexblock (256 × 16 B) + strängposter (8-bytejusterade) och mappar om `TStringIndex.ObjIndex` till objektens nya index.
 */
import { MapFileError, type ParsedMap } from "../../model";
import type { OcdObjectLocator } from "../../revision/change-set";
import { Bytes, indexBlocks } from "../bytes";
import { HEADER, OBJECT_BLOCK_SIZE, STATUS_NORMAL, SYMBOL_BLOCK_SIZE, variantFor } from "../layout";
import { readOcd } from "../read";
import {
  HEADER_EXTRA, OBJ_INDEX, OBJ_STATUS, STRING_BLOCK_SIZE, SYMBOL_HEAD, type OcdDocument, type RawOcdObject, type RawOcdString
} from "./ocd-document";

export interface PackOcdResult {
  readonly bytes: Uint8Array;
  /** Mappning från `RawOcdObject.key` till dess nya locator i den packade filen. */
  readonly objectLocators: ReadonlyMap<number, OcdObjectLocator>;
  /** Mappning från `RawOcdObject.key` till dess nya 1-baserade `ObjIndex` (`block * 256 + slot + 1`). */
  readonly objectIndices: ReadonlyMap<number, number>;
}

export type OcdDocumentVerifyResult =
  | { readonly ok: true; readonly map: ParsedMap }
  | { readonly ok: false; readonly message: string };

export interface VerifyOcdDocumentExpectations {
  readonly minObjects?: number | undefined;
  readonly exactObjects?: number | undefined;
  readonly symbols?: readonly number[] | undefined;
  readonly colors?: readonly number[] | undefined;
  /** Nycklar/locators för nyskrivna eller ändrade objekt som måste ha strikt positiv `rc` (`x0 < x1 && y0 < y1`). */
  readonly strictRcLocators?: ReadonlySet<string> | undefined;
}

const align8 = (offset: number): number => (offset + 7) & ~7;

/** Packar ett `OcdDocument` deterministiskt utan döda hål (8-bytejusterat). */
export function packOcdDocument(doc: OcdDocument): PackOcdResult {
  // Behåll alla levande objekt (normala + Status=2 dolda + Sym<0 + krypterade); filtrera bort ev. raderade poster.
  const liveObjects: RawOcdObject[] = doc.objects.filter(
    obj => obj.status !== OBJ_STATUS.deleted && obj.status !== OBJ_STATUS.deletedUndo
  );
  const objectIndices = new Map<number, number>();
  liveObjects.forEach((obj, i) => {
    objectIndices.set(obj.key, i + 1); // 1-baserat: block * 256 + slot + 1 === i + 1
  });

  // Filtrera strängar: rensa bort strängar vars länkade objekt inte längre finns i filen.
  const activeStrings: RawOcdString[] = doc.strings.filter(
    str => str.recType >= 0 && (str.objKey === null || objectIndices.has(str.objKey))
  );

  // Pass 1: exakt storleks- och offsetplanering i en enda allokering.
  let cursor = doc.header.length;

  let fileNamePos = 0;
  let fileNameSize = 0;
  if (doc.fileNameBytes && doc.fileNameBytes.length > 0) {
    fileNamePos = cursor;
    fileNameSize = doc.fileNameBytes.length;
    cursor += fileNameSize;
  }

  let infoPos = 0;
  let infoSize = 0;
  if (doc.variant.version < 12 && doc.infoBytes && doc.infoBytes.length > 0) {
    cursor = align8(cursor);
    infoPos = cursor;
    infoSize = doc.infoBytes.length;
    cursor += infoSize;
  }

  // Symbolindexblock + symbolposter.
  const symBlockCount = doc.symbols.length === 0 ? 0 : Math.ceil(doc.symbols.length / 256);
  const symBlockOffsets: number[] = [];
  const symOffsets: number[] = [];
  for (let b = 0; b < symBlockCount; b++) {
    cursor = align8(cursor);
    symBlockOffsets.push(cursor);
    cursor += SYMBOL_BLOCK_SIZE;
    const end = Math.min(doc.symbols.length, (b + 1) * 256);
    for (let i = b * 256; i < end; i++) {
      cursor = align8(cursor);
      symOffsets.push(cursor);
      cursor += doc.symbols[i]!.bytes.length;
    }
  }

  // Objektindexblock + objektposter.
  const objBlockCount = liveObjects.length === 0 ? 0 : Math.ceil(liveObjects.length / 256);
  const objBlockOffsets: number[] = [];
  const objOffsets: number[] = [];
  for (let b = 0; b < objBlockCount; b++) {
    cursor = align8(cursor);
    objBlockOffsets.push(cursor);
    cursor += OBJECT_BLOCK_SIZE;
    const end = Math.min(liveObjects.length, (b + 1) * 256);
    for (let i = b * 256; i < end; i++) {
      cursor = align8(cursor);
      objOffsets.push(cursor);
      cursor += liveObjects[i]!.record.length;
    }
  }

  // Strängindexblock + strängdata.
  const strBlockCount = activeStrings.length === 0 ? 0 : Math.ceil(activeStrings.length / 256);
  const strBlockOffsets: number[] = [];
  const strOffsets: number[] = [];
  for (let b = 0; b < strBlockCount; b++) {
    cursor = align8(cursor);
    strBlockOffsets.push(cursor);
    cursor += STRING_BLOCK_SIZE;
    const end = Math.min(activeStrings.length, (b + 1) * 256);
    for (let i = b * 256; i < end; i++) {
      cursor = align8(cursor);
      strOffsets.push(cursor);
      cursor += activeStrings[i]!.raw.length;
    }
  }

  const totalSize = align8(cursor);
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  // Pass 2: skriv filhuvud och alla sektioner.
  out.set(doc.header, 0);
  view.setUint32(HEADER.firstSymbolBlock, symBlockOffsets[0] ?? 0, true);
  view.setUint32(HEADER.firstObjectBlock, objBlockOffsets[0] ?? 0, true);
  view.setUint32(HEADER.firstStringBlock, strBlockOffsets[0] ?? 0, true);
  view.setUint32(HEADER_EXTRA.fileNamePos, fileNamePos, true);
  view.setUint32(HEADER_EXTRA.fileNameSize, fileNameSize, true);
  if (doc.variant.version < 12) {
    view.setUint32(HEADER_EXTRA.infoPos, infoPos, true);
    view.setUint32(HEADER_EXTRA.infoSize, infoSize, true);
  } else if (doc.header.length >= HEADER_EXTRA.sketchPos + 4) {
    // Nollställ ej ompackade interna blockpekare i v12/2018 (undviker hängande filpekare vid kompaktering).
    view.setUint32(HEADER_EXTRA.mrStartBlock, 0, true);
    view.setUint32(HEADER_EXTRA.sketchPos, 0, true);
  }

  if (doc.fileNameBytes && fileNamePos > 0) out.set(doc.fileNameBytes, fileNamePos);
  if (doc.infoBytes && infoPos > 0) out.set(doc.infoBytes, infoPos);

  // Skriv symbolblock och symbolposter (uppdatera Size på 0 och FilePos på 20).
  for (let b = 0; b < symBlockCount; b++) {
    const blockAt = symBlockOffsets[b]!;
    view.setUint32(blockAt, symBlockOffsets[b + 1] ?? 0, true);
    const start = b * 256;
    const end = Math.min(doc.symbols.length, start + 256);
    for (let i = start; i < end; i++) {
      const slot = i - start;
      const sym = doc.symbols[i]!;
      const symAt = symOffsets[i]!;
      view.setInt32(blockAt + 4 + slot * 4, symAt, true);
      out.set(sym.bytes, symAt);
      view.setInt32(symAt + SYMBOL_HEAD.size, sym.bytes.length, true);
      view.setInt32(symAt + SYMBOL_HEAD.filePos, symAt, true);
    }
  }

  // Skriv objektindexblock och objektposter.
  const objectLocators = new Map<number, OcdObjectLocator>();
  for (let b = 0; b < objBlockCount; b++) {
    const blockAt = objBlockOffsets[b]!;
    view.setUint32(blockAt, objBlockOffsets[b + 1] ?? 0, true);
    const start = b * 256;
    const end = Math.min(liveObjects.length, start + 256);
    for (let i = start; i < end; i++) {
      const slot = i - start;
      const obj = liveObjects[i]!;
      const recAt = objOffsets[i]!;
      const entryAt = blockAt + 4 + slot * OBJ_INDEX.size;
      out.set(obj.indexEntry.subarray(0, OBJ_INDEX.size), entryAt);
      view.setInt32(entryAt + OBJ_INDEX.position, recAt, true);
      view.setInt32(entryAt + OBJ_INDEX.length, obj.record.length, true);
      view.setInt32(entryAt + OBJ_INDEX.symbol, obj.symbol, true);
      view.setUint8(entryAt + OBJ_INDEX.type, obj.type);
      view.setUint8(entryAt + OBJ_INDEX.encrypted, obj.encrypted ? 1 : 0);
      view.setUint8(entryAt + OBJ_INDEX.status, obj.status);
      out.set(obj.record, recAt);
      objectLocators.set(obj.key, { format: "OCD", block: b, slot, offset: recAt, length: obj.record.length });
    }
  }

  // Skriv strängindexblock och strängdata med ommappade ObjIndex.
  for (let b = 0; b < strBlockCount; b++) {
    const blockAt = strBlockOffsets[b]!;
    view.setUint32(blockAt, strBlockOffsets[b + 1] ?? 0, true);
    const start = b * 256;
    const end = Math.min(activeStrings.length, start + 256);
    for (let i = start; i < end; i++) {
      const slot = i - start;
      const str = activeStrings[i]!;
      const strAt = strOffsets[i]!;
      const entryAt = blockAt + 4 + slot * 16;
      const objIndex = str.objKey === null ? 0 : (objectIndices.get(str.objKey) ?? 0);
      view.setInt32(entryAt, strAt, true);
      view.setInt32(entryAt + 4, str.raw.length, true);
      view.setInt32(entryAt + 8, str.recType, true);
      view.setInt32(entryAt + 12, objIndex, true);
      out.set(str.raw, strAt);
    }
  }

  return { bytes: out, objectLocators, objectIndices };
}

/** Återläser och verifierar en packad OCAD-fil: struktur, `FilePos`, `ObjIndex`, `rc`, datum, symboler och färger. */
export function verifyOcdDocument(data: Uint8Array, expected: VerifyOcdDocumentExpectations = {}): OcdDocumentVerifyResult {
  let map: ParsedMap;
  try {
    map = readOcd(data, { sources: true });
  } catch (error) {
    return { ok: false, message: `Den packade OCAD-filen går inte att läsa: ${error instanceof MapFileError ? error.message : String(error)}` };
  }

  const bytes = new Bytes(data);
  const version = bytes.u16(HEADER.version);
  const variant = variantFor(version);
  if (!variant || variant.version < 9) {
    return { ok: false, message: `Ogiltig OCAD-version i packad fil (${version}).` };
  }

  const fnPos = bytes.u32(HEADER_EXTRA.fileNamePos);
  const fnSize = bytes.u32(HEADER_EXTRA.fileNameSize);
  if ((fnPos > 0 || fnSize > 0) && !bytes.has(fnPos, fnSize)) {
    return { ok: false, message: "Filhuvudets FileNamePos/FileNameSize pekar utanför filen." };
  }
  if (variant.version < 12) {
    const infoPos = bytes.u32(HEADER_EXTRA.infoPos);
    const infoSize = bytes.u32(HEADER_EXTRA.infoSize);
    if ((infoPos > 0 || infoSize > 0) && !bytes.has(infoPos, infoSize)) {
      return { ok: false, message: "Filhuvudets InfoPos/InfoSize pekar utanför filen." };
    }
  } else if (data.length >= HEADER_EXTRA.sketchPos + 4) {
    const mrPos = bytes.u32(HEADER_EXTRA.mrStartBlock);
    const sketchPos = bytes.u32(HEADER_EXTRA.sketchPos);
    if (mrPos !== 0 && !bytes.has(mrPos, 4)) return { ok: false, message: "Filhuvudets MrStartBlockPos pekar utanför filen." };
    if (sketchPos !== 0 && !bytes.has(sketchPos, 4)) return { ok: false, message: "Filhuvudets SketchPos pekar utanför filen." };
  }

  // Kontrollera symbolblock och TBaseSym.FilePos.
  const firstSym = bytes.u32(HEADER.firstSymbolBlock);
  const symNumbers = new Set<number>();
  if (firstSym !== 0) {
    for (const block of indexBlocks(bytes, firstSym, SYMBOL_BLOCK_SIZE)) {
      for (let slot = 0; slot < 256; slot++) {
        const pos = bytes.i32(block + 4 + slot * 4);
        if (pos <= 0) continue;
        const size = bytes.i32(pos);
        if (size < variant.symbolBody || !bytes.has(pos, size)) {
          return { ok: false, message: `Symbolposten på position ${pos} har ogiltig storlek (${size}).` };
        }
        const filePos = bytes.i32(pos + SYMBOL_HEAD.filePos);
        if (filePos !== pos) {
          return { ok: false, message: `Symbolens FilePos (${filePos}) stämmer inte med filpositionen (${pos}).` };
        }
        symNumbers.add(bytes.i32(pos + SYMBOL_HEAD.number));
      }
    }
  }

  // Kontrollera objektindexblock, postparitet, rc och v12-datum.
  const firstObj = bytes.u32(HEADER.firstObjectBlock);
  const occupiedIndices = new Set<number>();
  if (firstObj !== 0) {
    const blocks = indexBlocks(bytes, firstObj, OBJECT_BLOCK_SIZE);
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b]!;
      for (let slot = 0; slot < 256; slot++) {
        const entry = block + 4 + slot * OBJ_INDEX.size;
        const pos = bytes.i32(entry + OBJ_INDEX.position);
        if (pos <= 0) continue;
        const len = bytes.i32(entry + OBJ_INDEX.length);
        if (len < variant.object.coords || !bytes.has(pos, len)) {
          return { ok: false, message: `Objektposten i block ${b}, plats ${slot} har ogiltig storlek (${len}).` };
        }
        occupiedIndices.add(b * 256 + slot + 1);
        const status = bytes.u8(entry + OBJ_INDEX.status);
        const sym = bytes.i32(entry + OBJ_INDEX.symbol);
        if (status !== STATUS_NORMAL || sym <= 0 || bytes.u8(entry + OBJ_INDEX.encrypted) !== 0) continue;
        const entryType = bytes.u8(entry + OBJ_INDEX.type);
        const recordType = bytes.u8(pos + variant.object.type);
        if (entryType !== recordType) {
          return { ok: false, message: `Objekttypen i block ${b}, plats ${slot} (${entryType}/${recordType}) stämmer inte.` };
        }
        if (sym !== bytes.i32(pos)) {
          return { ok: false, message: `Symbolnumret i index och post i block ${b}, plats ${slot} stämmer inte.` };
        }
        const x0 = bytes.i32(entry) >> 8, y0 = bytes.i32(entry + 4) >> 8;
        const x1 = bytes.i32(entry + 8) >> 8, y1 = bytes.i32(entry + 12) >> 8;
        const strict = expected.strictRcLocators?.has(`${b}:${slot}`) === true;
        if (strict ? (x0 >= x1 || y0 >= y1) : (x0 > x1 || y0 > y1)) {
          return { ok: false, message: `Omslutande rektangel (rc) i block ${b}, plats ${slot} är ogiltig.` };
        }
        if (variant.version >= 12 && (!Number.isFinite(bytes.f64(pos + 24)) || !Number.isFinite(bytes.f64(pos + 36)))) {
          return { ok: false, message: `Objektet i block ${b}, plats ${slot} har ogiltigt datum (NaN).` };
        }
      }
    }
  }

  // Kontrollera strängindexblock och TStringIndex.ObjIndex.
  const firstStr = bytes.u32(HEADER.firstStringBlock);
  if (firstStr !== 0) {
    for (const block of indexBlocks(bytes, firstStr, STRING_BLOCK_SIZE)) {
      for (let slot = 0; slot < 256; slot++) {
        const entry = block + 4 + slot * 16;
        const pos = bytes.i32(entry);
        const len = bytes.i32(entry + 4);
        const recType = bytes.i32(entry + 8);
        const objIndex = bytes.i32(entry + 12);
        if (pos <= 0 || len <= 0 || recType < 0) continue;
        if (!bytes.has(pos, len)) {
          return { ok: false, message: `Parametersträngen vid position ${pos} ligger utanför filen.` };
        }
        if (objIndex > 0 && !occupiedIndices.has(objIndex)) {
          return { ok: false, message: `Parametersträng (typ ${recType}) har hängande ObjIndex ${objIndex}.` };
        }
      }
    }
  }

  if (expected.exactObjects !== undefined && map.objects.length !== expected.exactObjects) {
    return { ok: false, message: `Fel antal objekt (${map.objects.length}, förväntade ${expected.exactObjects}).` };
  }
  if (expected.minObjects !== undefined && map.objects.length < expected.minObjects) {
    return { ok: false, message: `För få objekt (${map.objects.length}, förväntade minst ${expected.minObjects}).` };
  }
  if (expected.symbols) {
    for (const num of expected.symbols) {
      if (!symNumbers.has(num)) return { ok: false, message: `Förväntad symbol ${num} saknas i den packade filen.` };
    }
  }
  if (expected.colors) {
    const present = new Set(map.colors.map(color => color.id));
    for (const colorId of expected.colors) {
      if (!present.has(colorId)) return { ok: false, message: `Förväntad färg ${colorId} saknas i den packade filen.` };
    }
  }
  return { ok: true, map };
}

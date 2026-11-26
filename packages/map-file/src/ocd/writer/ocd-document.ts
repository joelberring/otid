/**
 * Etapp 4A (OCAD Steg 2): förlustfri strukturerad IR-modell (`OcdDocument`) för OCAD-filer (version 9–2018+).
 *
 * All kod är skriven clean-room utifrån O-Tids befintliga OCAD-kännedom (`layout.ts`, `read.ts`, `strings.ts`, `symbols.ts`)
 * och binära formatkontroller mot riktiga filer. Orörda symboler, objekt (inkl. `Status = 2` dolda, `Sym < 0` grafik/bilder,
 * krypterade samt objekt med objektsträngar) och okända parametersträngar bevaras byte-för-byte.
 */
import { MapFileError } from "../../model";
import type { OcdObjectLocator } from "../../revision/change-set";
import { Bytes, decode8, indexBlocks } from "../bytes";
import { HEADER, OCD_MARK, SYMBOL, SYMBOL_BLOCK_SIZE, variantFor, type OcdVariant } from "../layout";

export const STRING_BLOCK_SIZE = 4 + 256 * 16;
export const HEADER_V9_SIZE = 48;
export const HEADER_V12_SIZE = 60;

/** Extra fält i `TFileHeader` som `packOcdDocument` hanterar för att inga pekare ska bli hängande. */
export const HEADER_EXTRA = {
  /** v9–11: filinfotext (`InfoPos`, `InfoSize`). I v12+ reserverat (0). */
  infoPos: 24,
  infoSize: 28,
  /** v9–2018+: sparat filnamn i headern (`FileNamePos`, `FileNameSize`). */
  fileNamePos: 36,
  fileNameSize: 40,
  /** v12+: multirepresentationsblock (`MrStartBlockPos`, 0 om ej använt). */
  mrStartBlock: 48,
  /** v12/2018+: skisslagerblock (`SketchPos`, interna filpekare — nollas vid ompackning om blocket inte skrivs). */
  sketchPos: 52
} as const;

/** Extra fält i `TBaseSym` (v9–2018+ har identisk layout på offset 0..55 före `Description` på 56). */
export const SYMBOL_HEAD = {
  size: 0,
  number: 4,
  type: 8,
  flags: 9,
  selected: 10,
  status: 11,
  preferredTool: 12,
  csMode: 13,
  csObjType: 14,
  csCdFlags: 15,
  extent: 16,
  /** `TBaseSym.FilePos`: filpositionen i byte, krävs av OCAD *Map → Optimize/Repair*. */
  filePos: 20,
  group: 24,
  nColors: 26,
  /** `Colors[0..13]`: upp till 14 16-bitars färgnummer. */
  colors: 28,
  maxColors: 14,
  description: 56,
  /** v11+: 22×22 8-bitars ikon (484 byte, 5×5×5 RGB-kub 0..124 där 124 = vit bakgrund). */
  iconBitsV11: 184,
  iconSize: 22,
  iconBytes: 22 * 22
} as const;

/** `TObjectIndex` (40 byte i v9–2018+). */
export const OBJ_INDEX = {
  rect: 0,
  position: 16,
  length: 20,
  symbol: 24,
  type: 28,
  encrypted: 29,
  status: 30,
  view: 31,
  color: 32,
  impLayer: 34,
  size: 40
} as const;

export const OBJ_STATUS = { deleted: 0, normal: 1, hidden: 2, deletedUndo: 3 } as const;

export interface RawOcdSymbol {
  number: number;
  type: number;
  status: number;
  filePos: number;
  bytes: Uint8Array;
}

export interface RawOcdObject {
  /** Stabil nyckel i dokumentet så att `TStringIndex.ObjIndex` följer med objektet över kompaktering. */
  readonly key: number;
  /** Ursprungligt 1-baserat objektindex (`block * 256 + slot + 1`), eller `null` för nya objekt. */
  readonly originalIndex: number | null;
  /** Ursprunglig index-locator (block/slot/offset/length), eller `null` för nya objekt. */
  readonly originalLocator: OcdObjectLocator | null;
  /** 40-byte `TObjectIndex`-post (v9–2018+). */
  indexEntry: Uint8Array;
  /** Rå objektpost (huvud + koordinater + text + ev. objektsträngar). */
  record: Uint8Array;
  symbol: number;
  type: number;
  status: number;
  encrypted: boolean;
}

export interface RawOcdString {
  recType: number;
  /** Rå null-terminerade bytes i originalkodning (bevaras byte-för-byte för orörda strängar). */
  raw: Uint8Array;
  /** Stabil `RawOcdObject.key` när strängen var länkad via `TStringIndex.ObjIndex > 0`, annars `null`. */
  objKey: number | null;
}

export interface OcdDocument {
  readonly version: number;
  readonly subversion: number;
  readonly variant: OcdVariant;
  /** Hela filhuvudet (60 byte i v12+, 48 byte i v9–11). */
  header: Uint8Array;
  /** Filnamnssträngen på `FileNamePos` (om närvarande i originalet). */
  fileNameBytes: Uint8Array | null;
  /** Filinfo på `InfoPos` (enbart v9–11 om närvarande i originalet). */
  infoBytes: Uint8Array | null;
  symbols: RawOcdSymbol[];
  objects: RawOcdObject[];
  strings: RawOcdString[];
  nextObjectKey: number;
}

export interface ParseOcdDocumentOptions {
  /** Tillåt specialfiler (`fileType !== 0`) och `OfflineSyncSerial !== 0` (endast för inspektion/tester). */
  readonly allowUnsafe?: boolean | undefined;
}

const MAX_SYMBOLS = 100_000;
const MAX_SYMBOL_BYTES = 1 << 20;
const MAX_STRING_BYTES = 1 << 20;
const MAX_HEADER_BLOB = 1 << 20;

/** Säkerhetskontroll för OCAD-filhuvud: vägrar v8, banläggning (`FileType = 1`), OCAD Server (`8`) och `OfflineSyncSerial`. */
export function assertSafeOcdHeader(bytes: Bytes, allowUnsafe = false): { version: number; subversion: number; variant: OcdVariant } {
  if (!bytes.has(0, HEADER.size)) {
    throw new MapFileError("TRUNCATED", "OCAD-filen är för kort för att ha ett filhuvud.");
  }
  if (bytes.u16(HEADER.mark) !== OCD_MARK) {
    throw new MapFileError("NOT_A_MAP_FILE", "Filen är inte en OCAD-karta.");
  }
  const version = bytes.u16(HEADER.version);
  if (version > 3000) {
    throw new MapFileError("INVALID", `OCAD-filen anger en orimlig version (${version}).`);
  }
  const variant = variantFor(version);
  if (!variant || variant.version < 9) {
    throw new MapFileError("UNSUPPORTED_VERSION", `OCAD ${version} stöds inte för skrivning. Spara kartan i OCAD 9 eller senare.`);
  }
  if (!allowUnsafe) {
    const fileType = bytes.u16(HEADER.fileType);
    if (fileType !== 0) {
      const baseType = fileType & 0xff;
      const detail = baseType === 1 ? "en banläggningsfil (FileType 1)"
        : baseType === 8 ? "en OCAD Server-fil (FileType 8)"
        : `en OCAD-specialfil (FileType ${fileType})`;
      throw new MapFileError("INVALID", `OCAD-filen är ${detail} och kan inte sparas om här.`);
    }
    if (variant.version >= 12 && bytes.i32(HEADER.offlineSyncSerial) !== 0) {
      throw new MapFileError("INVALID", "OCAD-filen är kopplad till OCAD Server (OfflineSyncSerial) och kan inte sparas om här.");
    }
  }
  return { version, subversion: bytes.u8(HEADER.subversion), variant };
}

function recordLength(bytes: Bytes, at: number, indexLength: number, variant: OcdVariant): number {
  if (indexLength > 0 && bytes.has(at, indexLength)) return indexLength;
  const layout = variant.object;
  if (!bytes.has(at, layout.coords)) {
    throw new MapFileError("TRUNCATED", "OCAD-filen är avkortad (ett objekt ligger utanför filen).");
  }
  const count = bytes.u32(at + layout.coordCount);
  const textWords = bytes.u16(at + layout.textCount);
  const size = layout.coords + (count + textWords) * 8;
  bytes.check(at, size, "objekt");
  return size;
}

/** Läser en OCAD 9–2018+-fil till en förlustfri strukturerad `OcdDocument`-representation. */
export function parseOcdDocument(data: Uint8Array, options: ParseOcdDocumentOptions = {}): OcdDocument {
  const bytes = new Bytes(data);
  const { version, subversion, variant } = assertSafeOcdHeader(bytes, options.allowUnsafe === true);
  const headerLen = variant.version >= 12 && bytes.length >= HEADER_V12_SIZE ? HEADER_V12_SIZE : HEADER_V9_SIZE;
  const header = data.slice(0, headerLen);

  // Filnamnssträng på FileNamePos/FileNameSize (t.ex. offset 60, 128 byte i OCAD 2018).
  let fileNameBytes: Uint8Array | null = null;
  const fnPos = bytes.u32(HEADER_EXTRA.fileNamePos);
  const fnSize = bytes.u32(HEADER_EXTRA.fileNameSize);
  if (fnPos > 0 && fnSize > 0 && fnSize <= MAX_HEADER_BLOB && bytes.has(fnPos, fnSize)) {
    fileNameBytes = data.slice(fnPos, fnPos + fnSize);
  }

  // Filinfoblock i v9–11 (offset 24/28).
  let infoBytes: Uint8Array | null = null;
  if (variant.version < 12) {
    const infoPos = bytes.u32(HEADER_EXTRA.infoPos);
    const infoSize = bytes.u32(HEADER_EXTRA.infoSize);
    if (infoPos > 0 && infoSize > 0 && infoSize <= MAX_HEADER_BLOB && bytes.has(infoPos, infoSize)) {
      infoBytes = data.slice(infoPos, infoPos + infoSize);
    }
  }

  // 1. Symboler (bevaras byte-för-byte; orörda symboler skrivs ut identiskt förutom nytt FilePos).
  const symbols: RawOcdSymbol[] = [];
  const firstSym = bytes.u32(HEADER.firstSymbolBlock);
  if (firstSym !== 0) {
    for (const block of indexBlocks(bytes, firstSym, SYMBOL_BLOCK_SIZE)) {
      for (let slot = 0; slot < 256; slot++) {
        const pos = bytes.i32(block + 4 + slot * 4);
        if (pos <= 0) continue;
        if (symbols.length >= MAX_SYMBOLS) break;
        const size = bytes.i32(pos + SYMBOL.size);
        if (size < variant.symbolBody || size > MAX_SYMBOL_BYTES) {
          throw new MapFileError("INVALID", `Ogiltig symbolstorlek (${size}) vid position ${pos}.`);
        }
        bytes.check(pos, size, "symbol");
        symbols.push({
          number: bytes.i32(pos + SYMBOL.number),
          type: bytes.u8(pos + SYMBOL.type),
          status: bytes.u8(pos + SYMBOL.status),
          filePos: bytes.i32(pos + SYMBOL_HEAD.filePos),
          bytes: data.slice(pos, pos + size)
        });
      }
    }
  }

  // 2. Objekt (bevarar Status=1 normala, Status=2 dolda, Sym<0 grafik/bilder, krypterade och objektsträngar; rensar Status=0/3).
  const objects: RawOcdObject[] = [];
  const originalIndexToKey = new Map<number, number>();
  let nextObjectKey = 1;
  const firstObj = bytes.u32(HEADER.firstObjectBlock);
  if (firstObj !== 0) {
    const blocks = indexBlocks(bytes, firstObj, variant.index.blockSize);
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b]!;
      for (let slot = 0; slot < 256; slot++) {
        const entryAt = block + 4 + slot * OBJ_INDEX.size;
        const pos = bytes.i32(entryAt + OBJ_INDEX.position);
        if (pos <= 0) continue;
        const status = bytes.u8(entryAt + OBJ_INDEX.status);
        if (status === OBJ_STATUS.deleted || status === OBJ_STATUS.deletedUndo) continue;
        const indexLen = bytes.i32(entryAt + OBJ_INDEX.length);
        const len = recordLength(bytes, pos, indexLen, variant);
        const originalIndex = b * 256 + slot + 1;
        const key = nextObjectKey++;
        originalIndexToKey.set(originalIndex, key);
        objects.push({
          key,
          originalIndex,
          originalLocator: { format: "OCD", block: b, slot, offset: pos, length: len },
          indexEntry: data.slice(entryAt, entryAt + OBJ_INDEX.size),
          record: data.slice(pos, pos + len),
          symbol: bytes.i32(entryAt + OBJ_INDEX.symbol),
          type: bytes.u8(entryAt + OBJ_INDEX.type),
          status,
          encrypted: bytes.u8(entryAt + OBJ_INDEX.encrypted) !== 0
        });
      }
    }
  }

  // 3. Strängparametrar (bevarar alla aktiva RecType >= 0, mappar TStringIndex.ObjIndex till stabil `objKey`).
  const strings: RawOcdString[] = [];
  const firstStr = bytes.u32(HEADER.firstStringBlock);
  if (firstStr !== 0) {
    let budget = bytes.length;
    for (const block of indexBlocks(bytes, firstStr, STRING_BLOCK_SIZE)) {
      for (let slot = 0; slot < 256; slot++) {
        const entryAt = block + 4 + slot * 16;
        const pos = bytes.i32(entryAt);
        const len = bytes.i32(entryAt + 4);
        const recType = bytes.i32(entryAt + 8);
        const objIndex = bytes.i32(entryAt + 12);
        if (pos <= 0 || len <= 0 || recType < 0) continue;
        const size = Math.min(len, MAX_STRING_BYTES);
        bytes.check(pos, size, "inställning");
        budget -= size;
        if (budget < 0) {
          throw new MapFileError("INVALID", "OCAD-filen är trasig: inställningsposterna pekar på samma text flera gånger.");
        }
        let objKey: number | null = null;
        if (objIndex > 0) {
          const resolved = originalIndexToKey.get(objIndex);
          // Sträng som pekade på ett redan raderat objekt rensas vid kompaktering.
          if (resolved === undefined) continue;
          objKey = resolved;
        }
        strings.push({ recType, raw: data.slice(pos, pos + size), objKey });
      }
    }
  }

  return { version, subversion, variant, header, fileNameBytes, infoBytes, symbols, objects, strings, nextObjectKey };
}

/** Avkodar en rå OCAD-parametersträng fram till första nollbyten (UTF-8 med Windows-1252-fallback som läsaren). */
export function decodeOcdString(raw: Uint8Array): string {
  let end = 0;
  while (end < raw.length && raw[end]! !== 0) end++;
  return decode8(raw.subarray(0, end));
}

/** Kodar en OCAD-parametersträng med avslutande nollbyte, utfylld till närmaste 8-bytegräns (UTF-8 i v12+, Latin-1/UTF-8 i v9–11). */
export function encodeOcdString(value: string, version = 12): Uint8Array {
  const encoded = version < 12 ? encodeWindows1252(value) : new TextEncoder().encode(value);
  const paddedLen = Math.max(8, Math.ceil((encoded.length + 1) / 8) * 8);
  const out = new Uint8Array(paddedLen);
  out.set(encoded, 0);
  return out;
}

const WIN1252_EXTRA: Readonly<Record<number, number>> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
};

/** Kodar text till Windows-1252 för OCAD 9–11 (faller tillbaka på UTF-8 om tecknet inte finns i Windows-1252). */
export function encodeWindows1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0xff && (code < 0x80 || code >= 0xa0)) {
      out[i] = code;
    } else if (WIN1252_EXTRA[code] !== undefined) {
      out[i] = WIN1252_EXTRA[code]!;
    } else {
      return new TextEncoder().encode(text);
    }
  }
  return out;
}

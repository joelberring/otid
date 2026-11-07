/**
 * OCAD .ocd, version 8 och senare (ADR-0196; version 12+ sedan ADR-0179). Varje position och längd kontrolleras mot
 * filen, alla slingor är begränsade och index som pekar i cirkel avbryts, så att en trasig fil ger `MapFileError` i
 * stället för att hänga eller allokera. Skillnaderna mellan versionerna finns i `OcdVariant` (layout.ts).
 */
import { boundsOf, normalizeAngle, openRing } from "../geometry";
import { MapFileError, type MapObject, type MapSymbol, type ParsedMap, type ReadOptions } from "../model";
import { sha256Hex } from "../revision/sha256";
import { WarningCollector } from "../warnings";
import { Bytes, decode8, indexBlocks } from "./bytes";
import { coordsToParts, readCoords } from "./coords";
import { HEADER, MIN_VERSION, OBJECT_TYPE, OCD_MARK, STATUS_NORMAL, variantFor, type OcdVariant } from "./layout";
import { readColors, readGeoreference, readParameterStrings } from "./strings";
import { readOcdSymbols, v8SymbolNumber } from "./symbols";
import { readV8Colors, readV8Georeference } from "./v8";

/** Övre gräns för punkter i ett objekt (OCAD tillåter långt färre). */
const MAX_COORDS = 1 << 20;

export function readOcd(data: Uint8Array, options: ReadOptions = {}): ParsedMap {
  const bytes = new Bytes(data);
  if (!bytes.has(0, HEADER.size)) throw new MapFileError("TRUNCATED", "OCAD-filen är för kort för att ha ett filhuvud.");
  if (bytes.u16(HEADER.mark) !== OCD_MARK) throw new MapFileError("NOT_A_MAP_FILE", "Filen är inte en OCAD-karta.");
  const version = bytes.u16(HEADER.version);
  if (version > 3000) throw new MapFileError("INVALID", `OCAD-filen anger en orimlig version (${version}).`);
  const variant = variantFor(version);
  if (version < MIN_VERSION || !variant) {
    throw new MapFileError("UNSUPPORTED_VERSION", `OCAD ${version} stöds inte. Öppna kartan och spara den i nyare OCAD eller i Mapper.`);
  }
  // Version 12+ har under- och underunderversion som två byte; 8–11 har en 16-bitars underversion (11 skriver två byte).
  const subversion = bytes.u8(HEADER.subversion);

  const warnings = new WarningCollector();
  const strings = readParameterStrings(bytes, bytes.u32(HEADER.firstStringBlock));
  const colors = variant.version === 8 ? readV8Colors(bytes) : readColors(strings);
  const symbols = readOcdSymbols(bytes, bytes.u32(HEADER.firstSymbolBlock), warnings, variant);
  const objects = readObjects(bytes, bytes.u32(HEADER.firstObjectBlock), symbols, variant, warnings, options.sources === true);
  const { scale, georeference } = variant.version === 8 ? readV8Georeference(bytes, warnings) : readGeoreference(strings, warnings);
  return {
    format: "OCD",
    version: `OCAD ${version}.${subversion}`,
    colors,
    symbols,
    objects,
    scale,
    georeference,
    bounds: boundsOf(objects),
    warnings: warnings.list()
  };
}

function readObjects(
  bytes: Bytes, first: number, symbols: ReadonlyMap<string, MapSymbol>, variant: OcdVariant, warnings: WarningCollector, sources: boolean
): MapObject[] {
  const objects: MapObject[] = [];
  if (first === 0) return objects;
  const index = variant.index;
  const blocks = indexBlocks(bytes, first, index.blockSize);
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b]!;
    for (let k = 0; k < 256; k++) {
      const entry = block + 4 + k * index.entrySize;
      const position = bytes.i32(entry + index.position);
      if (position <= 0) continue;
      if (index.status !== null && bytes.u8(entry + index.status) !== STATUS_NORMAL) continue;
      // Version 8 saknar status; ett borttaget objekt har symbol 0.
      if (index.status === null && bytes.i16(entry + index.symbol) === 0) continue;
      const length = index.lengthInCoords ? variant.object.coords + bytes.u16(entry + index.length) * 8 : bytes.i32(entry + index.length);
      const object = readObject(bytes, position, length, symbols, variant, warnings);
      if (!object) continue;
      if (!sources) { objects.push(object); continue; }
      const size = recordLength(bytes, position, length, variant);
      const locator = { format: "OCD" as const, block: b, slot: k, offset: position, length: size };
      objects.push({ ...object, source: { locator, objectHash: sha256Hex(bytes.bytes, position, position + size) } });
    }
  }
  return objects;
}

/**
 * ADR-0219: postens längd i byte ur indexet (version 9+ i byte, där OCAD ibland lämnar plats efter texten; version 8 i
 * koordinater, redan omräknad). Saknas den eller går den utanför filen räknas den ur huvudet, punkterna och texten.
 */
function recordLength(bytes: Bytes, at: number, indexLength: number, variant: OcdVariant): number {
  if (indexLength > 0 && bytes.has(at, indexLength)) return indexLength;
  const layout = variant.object;
  const count = layout.coordCount16 ? bytes.u16(at + layout.coordCount) : bytes.u32(at + layout.coordCount);
  return Math.min(layout.coords + (count + bytes.u16(at + layout.textCount)) * 8, bytes.length - at);
}

function readObject(
  bytes: Bytes, at: number, length: number, symbols: ReadonlyMap<string, MapSymbol>, variant: OcdVariant, warnings: WarningCollector
): MapObject | null {
  const layout = variant.object;
  if (!bytes.has(at, layout.coords)) throw new MapFileError("TRUNCATED", "OCAD-filen är avkortad (ett objekt ligger utanför filen).");
  const rawSymbol = layout.symbol16 ? bytes.i16(at) : bytes.i32(at);
  const type = bytes.u8(at + layout.type);
  const count = layout.coordCount16 ? bytes.u16(at + layout.coordCount) : bytes.u32(at + layout.coordCount);
  const textCount = bytes.u16(at + layout.textCount);
  const room = length > 0 ? Math.min(length, bytes.length - at) : bytes.length - at;
  if (count === 0 || count > MAX_COORDS || layout.coords + (count + textCount) * 8 > room) {
    if (!bytes.has(at + layout.coords, count * 8)) throw new MapFileError("TRUNCATED", "OCAD-filen är avkortad (ett objekts punkter saknas).");
    warnings.add("BROKEN_OBJECT");
    return null;
  }
  // Negativa nummer är grafik (−2), bilder (−4) och liknande utan symbol, som Mapper också lägger utan symbol.
  if (rawSymbol < 0) { warnings.add("OBJECT_WITHOUT_SYMBOL"); return null; }
  const symbol = String(layout.symbol16 ? v8SymbolNumber(rawSymbol) : rawSymbol);
  const definition = symbols.get(symbol);
  if (!definition) { warnings.add("UNKNOWN_SYMBOL"); return null; }
  const coords = readCoords(bytes, at + layout.coords, count);
  const angle = normalizeAngle(bytes.i16(at + layout.angle) / 10);
  const first = { x: coords.x[0]!, y: coords.y[0]! };
  switch (type) {
    case OBJECT_TYPE.point:
      return { kind: "point", symbol, at: first, angle };
    case OBJECT_TYPE.text:
    case OBJECT_TYPE.formattedText:
    case OBJECT_TYPE.lineText: {
      if (type === OBJECT_TYPE.lineText) warnings.add("LINE_TEXT");
      const text = textCount > 0 ? objectText(bytes, at + layout.coords + count * 8, textCount * 8, variant, at) : "";
      return { kind: "text", symbol, at: first, angle, text: text.replace(/\r\n?/g, "\n") };
    }
    case OBJECT_TYPE.line:
    case OBJECT_TYPE.rectangle: {
      const parts = coordsToParts(coords, undefined, true);
      if (parts.length === 0) { warnings.add("BROKEN_OBJECT"); return null; }
      return { kind: "line", symbol, path: parts.flat() };
    }
    case OBJECT_TYPE.area: {
      const rings = coordsToParts(coords, undefined, true).map(openRing);
      if (rings.length === 0) { warnings.add("BROKEN_OBJECT"); return null; }
      return { kind: "area", symbol, rings, angle };
    }
    default:
      warnings.add("UNKNOWN_OBJECT_TYPE");
      return null;
  }
}

/** Objektets text: UTF-16, utom i version 8 där en flagga i objekthuvudet kan säga Windows-1252. */
function objectText(bytes: Bytes, offset: number, size: number, variant: OcdVariant, objectAt: number): string {
  const flag = variant.object.unicodeFlag;
  if (flag === null || bytes.u8(objectAt + flag) !== 0) return bytes.utf16(offset, size);
  bytes.check(offset, size, "text");
  const data = bytes.bytes.subarray(offset, offset + size);
  const end = data.indexOf(0);
  return decode8(end < 0 ? data : data.subarray(0, end));
}

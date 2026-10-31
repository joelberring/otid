/**
 * OCAD .ocd, version 12 och senare. Varje position och längd kontrolleras mot filen, alla slingor är begränsade och
 * index som pekar i cirkel avbryts, så att en trasig fil ger `MapFileError` i stället för att hänga eller allokera.
 */
import { boundsOf, normalizeAngle, openRing } from "../geometry";
import { MapFileError, type MapObject, type MapSymbol, type ParsedMap } from "../model";
import { WarningCollector } from "../warnings";
import { Bytes, indexBlocks } from "./bytes";
import { coordsToParts, readCoords } from "./coords";
import { HEADER, INDEX_ENTRY, MIN_VERSION, OBJECT, OBJECT_BLOCK_SIZE, OBJECT_TYPE, OCD_MARK, STATUS_NORMAL } from "./layout";
import { readColors, readGeoreference, readParameterStrings } from "./strings";
import { readOcdSymbols } from "./symbols";

/** Övre gräns för punkter i ett objekt (OCAD tillåter långt färre). */
const MAX_COORDS = 1 << 20;

export function readOcd(data: Uint8Array): ParsedMap {
  const bytes = new Bytes(data);
  if (!bytes.has(0, HEADER.size)) throw new MapFileError("TRUNCATED", "OCAD-filen är för kort för att ha ett filhuvud.");
  if (bytes.u16(HEADER.mark) !== OCD_MARK) throw new MapFileError("NOT_A_MAP_FILE", "Filen är inte en OCAD-karta.");
  const version = bytes.u16(HEADER.version);
  const subversion = bytes.u8(HEADER.subversion);
  if (version < MIN_VERSION) {
    throw new MapFileError("UNSUPPORTED_VERSION", `OCAD ${version} stöds inte. Spara kartan i OCAD 12 eller senare, eller som .omap i Mapper.`);
  }
  if (version > 3000) throw new MapFileError("INVALID", `OCAD-filen anger en orimlig version (${version}).`);

  const warnings = new WarningCollector();
  const strings = readParameterStrings(bytes, bytes.u32(HEADER.firstStringBlock));
  const colors = readColors(strings);
  const symbols = readOcdSymbols(bytes, bytes.u32(HEADER.firstSymbolBlock), warnings);
  const objects = readObjects(bytes, bytes.u32(HEADER.firstObjectBlock), symbols, warnings);
  const { scale, georeference } = readGeoreference(strings, warnings);
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

function readObjects(bytes: Bytes, first: number, symbols: ReadonlyMap<string, MapSymbol>, warnings: WarningCollector): MapObject[] {
  const objects: MapObject[] = [];
  if (first === 0) return objects;
  for (const block of indexBlocks(bytes, first, OBJECT_BLOCK_SIZE)) {
    for (let index = 0; index < 256; index++) {
      const entry = block + 4 + index * INDEX_ENTRY.size;
      const position = bytes.i32(entry + INDEX_ENTRY.position);
      if (position <= 0) continue;
      if (bytes.u8(entry + INDEX_ENTRY.status) !== STATUS_NORMAL) continue;
      const length = bytes.i32(entry + INDEX_ENTRY.length);
      const object = readObject(bytes, position, length, symbols, warnings);
      if (object) objects.push(object);
    }
  }
  return objects;
}

function readObject(
  bytes: Bytes, at: number, length: number, symbols: ReadonlyMap<string, MapSymbol>, warnings: WarningCollector
): MapObject | null {
  if (!bytes.has(at, OBJECT.coords)) throw new MapFileError("TRUNCATED", "OCAD-filen är avkortad (ett objekt ligger utanför filen).");
  const number = bytes.i32(at + OBJECT.symbol);
  const type = bytes.u8(at + OBJECT.type);
  const count = bytes.u32(at + OBJECT.coordCount);
  const textCount = bytes.u16(at + OBJECT.textCount);
  const room = length > 0 ? Math.min(length, bytes.length - at) : bytes.length - at;
  if (count === 0 || count > MAX_COORDS || OBJECT.coords + (count + textCount) * 8 > room) {
    if (!bytes.has(at + OBJECT.coords, count * 8)) throw new MapFileError("TRUNCATED", "OCAD-filen är avkortad (ett objekts punkter saknas).");
    warnings.add("BROKEN_OBJECT");
    return null;
  }
  // Negativa nummer är grafik (−2), bilder (−4) och liknande utan symbol, som Mapper också lägger utan symbol.
  if (number < 0) { warnings.add("OBJECT_WITHOUT_SYMBOL"); return null; }
  const symbol = String(number);
  const definition = symbols.get(symbol);
  if (!definition) { warnings.add("UNKNOWN_SYMBOL"); return null; }
  const coords = readCoords(bytes, at + OBJECT.coords, count);
  const angle = normalizeAngle(bytes.i16(at + OBJECT.angle) / 10);
  const first = { x: coords.x[0]!, y: coords.y[0]! };
  switch (type) {
    case OBJECT_TYPE.point:
      return { kind: "point", symbol, at: first, angle };
    case OBJECT_TYPE.text:
    case OBJECT_TYPE.formattedText:
    case OBJECT_TYPE.lineText: {
      if (type === OBJECT_TYPE.lineText) warnings.add("LINE_TEXT");
      const text = textCount > 0 ? bytes.utf16(at + OBJECT.coords + count * 8, textCount * 8) : "";
      return { kind: "text", symbol, at: first, angle, text: text.replace(/\r\n?/g, "\n") };
    }
    case OBJECT_TYPE.line:
    case OBJECT_TYPE.rectangle: {
      const parts = coordsToParts(coords);
      if (parts.length === 0) { warnings.add("BROKEN_OBJECT"); return null; }
      return { kind: "line", symbol, path: parts.flat() };
    }
    case OBJECT_TYPE.area: {
      const rings = coordsToParts(coords).map(openRing);
      if (rings.length === 0) { warnings.add("BROKEN_OBJECT"); return null; }
      return { kind: "area", symbol, rings, angle };
    }
    default:
      warnings.add("UNKNOWN_OBJECT_TYPE");
      return null;
  }
}

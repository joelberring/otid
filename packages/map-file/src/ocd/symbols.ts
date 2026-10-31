/** OCAD-symboler → modellens symboler. Mått i OCAD är 0,01 mm, vinklar 0,1 grad, textstorlek 0,1 punkt. */
import { ocdSymbolCode } from "../geometry";
import type { AreaSymbol, HatchStyle, LineSymbol, MapSymbol, PointElement, StrokeStyle, TextSymbol } from "../model";
import type { WarningCollector } from "../warnings";
import { indexBlocks, type Bytes } from "./bytes";
import { coordsToParts, readCoords } from "./coords";
import { AREA, ELEMENT, ELEMENT_TYPE, LINE, POINT, RECTANGLE, SYMBOL, SYMBOL_BLOCK_SIZE, SYMBOL_TYPE, TEXT, UNIT } from "./layout";

const MAX_SYMBOLS = 100_000;
const MAX_SYMBOL_BYTES = 1 << 20;
const POINT_PER_PT = 25.4 / 72;

export interface OcdSymbols {
  readonly symbols: Map<string, MapSymbol>;
  readonly kinds: Map<number, number>;
}

export function readOcdSymbols(bytes: Bytes, first: number, warnings: WarningCollector): OcdSymbols {
  const symbols = new Map<string, MapSymbol>();
  const kinds = new Map<number, number>();
  const borders = new Map<string, number>();
  if (first === 0) return { symbols, kinds };
  for (const block of indexBlocks(bytes, first, SYMBOL_BLOCK_SIZE)) {
    for (let index = 0; index < 256; index++) {
      const position = bytes.i32(block + 4 + index * 4);
      if (position <= 0) continue;
      if (symbols.size >= MAX_SYMBOLS) break;
      const size = bytes.i32(position + SYMBOL.size);
      if (size < SYMBOL.end || size > MAX_SYMBOL_BYTES) { warnings.add("BROKEN_SYMBOL"); continue; }
      bytes.check(position, size, "symbol");
      const number = bytes.i32(position + SYMBOL.number);
      const type = bytes.u8(position + SYMBOL.type);
      const id = String(number);
      const base = {
        id,
        code: ocdSymbolCode(number),
        name: bytes.utf16(position + SYMBOL.description, SYMBOL.descriptionBytes),
        hidden: (bytes.u8(position + SYMBOL.status) & 2) !== 0
      };
      const end = position + size;
      let symbol: MapSymbol | null;
      try {
        symbol = convert(bytes, position, end, type, base, warnings);
      } catch {
        // Trasiga ritdata inom en symbol som ändå ryms i filen: behåll symbolen utan ritning hellre än att tappa objekten.
        warnings.add("BROKEN_SYMBOL");
        symbol = emptySymbol(type, base);
      }
      if (!symbol) { warnings.add("UNKNOWN_SYMBOL_TYPE"); continue; }
      symbols.set(id, symbol);
      kinds.set(number, type);
      if (type === SYMBOL_TYPE.area && bytes.u8(position + AREA.borderOn) !== 0) {
        const border = bytes.i32(position + AREA.borderSymbol);
        if (border > 0) borders.set(id, border);
      }
    }
  }
  // Kantlinjen är en egen linjesymbol; den kopieras in när alla symboler är lästa.
  for (const [id, border] of borders) {
    const area = symbols.get(id);
    const line = symbols.get(String(border));
    if (area?.kind === "AREA" && line?.kind === "LINE") symbols.set(id, { ...area, border: line.strokes });
  }
  return { symbols, kinds };
}

type Base = Pick<MapSymbol, "id" | "code" | "name" | "hidden">;

function emptySymbol(type: number, base: Base): MapSymbol | null {
  switch (type) {
    case SYMBOL_TYPE.point: return { ...base, kind: "POINT", elements: [] };
    case SYMBOL_TYPE.line:
    case SYMBOL_TYPE.rectangle: return { ...base, kind: "LINE", strokes: [] };
    case SYMBOL_TYPE.area: return { ...base, kind: "AREA", hatches: [] };
    case SYMBOL_TYPE.text:
    case SYMBOL_TYPE.lineText: return { ...base, kind: "TEXT", color: 0, size: 2, fontFamily: "Arial", bold: false, italic: false };
    default: return null;
  }
}

function convert(bytes: Bytes, at: number, end: number, type: number, base: Base, warnings: WarningCollector): MapSymbol | null {
  switch (type) {
    case SYMBOL_TYPE.point: {
      const words = bytes.u16(at + POINT.dataSize);
      return { ...base, kind: "POINT", elements: readElements(bytes, at + POINT.elements, words, end, warnings) };
    }
    case SYMBOL_TYPE.line: return { ...base, kind: "LINE", ...lineSymbol(bytes, at, end, warnings) };
    case SYMBOL_TYPE.area: return { ...base, kind: "AREA", ...areaSymbol(bytes, at, end, warnings) };
    case SYMBOL_TYPE.text:
    case SYMBOL_TYPE.lineText: return { ...base, kind: "TEXT", ...textSymbol(bytes, at) };
    case SYMBOL_TYPE.rectangle: {
      const width = bytes.i16(at + RECTANGLE.width) * UNIT;
      const strokes: StrokeStyle[] = width > 0 ? [{ color: bytes.u16(at + RECTANGLE.color), width, join: "miter" }] : [];
      return { ...base, kind: "LINE", strokes };
    }
    default: return null;
  }
}

/** Ritelement: `words` är datastorleken i enheter om 8 byte (ett elementhuvud är två enheter, en koordinat en). */
function readElements(bytes: Bytes, start: number, words: number, end: number, warnings: WarningCollector): PointElement[] {
  const elements: PointElement[] = [];
  const stop = start + words * 8;
  if (stop > end) { warnings.add("BROKEN_SYMBOL"); return elements; }
  let position = start;
  while (position + ELEMENT.header <= stop) {
    const type = bytes.u16(position + ELEMENT.type);
    const color = bytes.u16(position + ELEMENT.color);
    const lineWidth = bytes.i16(position + ELEMENT.lineWidth) * UNIT;
    const diameter = bytes.i16(position + ELEMENT.diameter) * UNIT;
    const count = bytes.u16(position + ELEMENT.coordCount);
    const coordsAt = position + ELEMENT.header;
    if (coordsAt + count * 8 > stop) { warnings.add("BROKEN_SYMBOL"); break; }
    const coords = readCoords(bytes, coordsAt, count);
    const center = { x: coords.x[0] ?? 0, y: coords.y[0] ?? 0 };
    position = coordsAt + count * 8;
    switch (type) {
      case ELEMENT_TYPE.line:
        if (lineWidth > 0 && count >= 2) elements.push({ kind: "line", color, width: lineWidth, path: coordsToParts(coords).flat() });
        break;
      case ELEMENT_TYPE.area: {
        const rings = coordsToParts(coords);
        if (rings.length > 0) elements.push({ kind: "area", color, rings });
        break;
      }
      case ELEMENT_TYPE.circle:
        if (diameter > 0 && lineWidth > 0) elements.push({ kind: "circle", color, center, diameter, lineWidth });
        break;
      case ELEMENT_TYPE.dot:
        if (diameter > 0) elements.push({ kind: "dot", color, center, diameter });
        break;
      default:
        warnings.add("BROKEN_SYMBOL");
    }
  }
  return elements;
}

function styleOf(style: number): Pick<StrokeStyle, "cap" | "join"> {
  switch (style) {
    case 1: return { cap: "round", join: "round" };
    case 2: return { cap: "butt", join: "round" };
    case 4: return { cap: "butt", join: "miter" };
    default: return { cap: "butt", join: "bevel" };
  }
}

function lineSymbol(bytes: Bytes, at: number, end: number, warnings: WarningCollector): Pick<LineSymbol, "strokes" | "repeated"> {
  const strokes: StrokeStyle[] = [];
  const style = styleOf(bytes.u16(at + LINE.style));
  const framingWidth = bytes.i16(at + LINE.framingWidth) * UNIT;
  if (framingWidth > 0) strokes.push({ color: bytes.u16(at + LINE.framingColor), width: framingWidth, join: "round", cap: "round" });

  if (bytes.u16(at + LINE.doubleMode) !== 0) {
    const doubleWidth = bytes.i16(at + LINE.doubleWidth) * UNIT;
    if ((bytes.u16(at + LINE.doubleFlags) & 1) !== 0 && doubleWidth > 0) {
      strokes.push({ color: bytes.u16(at + LINE.doubleColor), width: doubleWidth, join: style.join });
    }
    const left = bytes.i16(at + LINE.doubleLeftWidth) * UNIT;
    const right = bytes.i16(at + LINE.doubleRightWidth) * UNIT;
    if (left > 0) strokes.push({ color: bytes.u16(at + LINE.doubleLeftColor), width: left, offset: doubleWidth / 2, join: style.join });
    if (right > 0) strokes.push({ color: bytes.u16(at + LINE.doubleRightColor), width: right, offset: -doubleWidth / 2, join: style.join });
  }

  const width = bytes.i16(at + LINE.width) * UNIT;
  if (width > 0) {
    const mainLength = bytes.i16(at + LINE.mainLength) * UNIT;
    const mainGap = bytes.i16(at + LINE.mainGap) * UNIT;
    const secondaryGap = bytes.i16(at + LINE.secondaryGap) * UNIT;
    let dash: number[] | undefined;
    if (mainLength > 0 && (mainGap > 0 || secondaryGap > 0)) {
      if (secondaryGap > 0) {
        const half = Math.max((mainLength - secondaryGap) / 2, 0.01);
        dash = mainGap > 0 ? [half, secondaryGap, half, mainGap] : [mainLength - secondaryGap, secondaryGap];
      } else {
        dash = [mainLength, mainGap];
      }
    }
    strokes.push({ color: bytes.u16(at + LINE.color), width, ...style, dash });
  }

  const primaryWords = bytes.u16(at + LINE.primaryDataSize);
  const symbolCount = bytes.i16(at + LINE.symbolCount);
  let repeated: LineSymbol["repeated"];
  if (primaryWords > 0 && symbolCount > 0) {
    const elements = readElements(bytes, at + LINE.elements, primaryWords, end, warnings);
    const spacing = bytes.i16(at + LINE.mainLength) * UNIT;
    if (elements.length > 0 && spacing > 0) repeated = { elements, spacing };
  }
  return { strokes, repeated };
}

function areaSymbol(bytes: Bytes, at: number, end: number, warnings: WarningCollector): Pick<AreaSymbol, "fill" | "hatches" | "pattern"> {
  const fill = bytes.u8(at + AREA.fillOn) !== 0 ? bytes.u16(at + AREA.fillColor) : undefined;
  const hatches: HatchStyle[] = [];
  const hatchMode = bytes.u16(at + AREA.hatchMode);
  if (hatchMode === 1 || hatchMode === 2) {
    const color = bytes.u16(at + AREA.hatchColor);
    const width = bytes.u16(at + AREA.hatchWidth) * UNIT;
    const spacing = bytes.u16(at + AREA.hatchDistance) * UNIT;
    const angles = [bytes.i16(at + AREA.hatchAngle1), ...(hatchMode === 2 ? [bytes.i16(at + AREA.hatchAngle2)] : [])];
    if (width > 0 && spacing > 0) for (const angle of angles) hatches.push({ color, width, spacing, angle: angle / 10 });
  }
  let pattern: AreaSymbol["pattern"];
  const structureMode = bytes.u8(at + AREA.structureMode);
  if (structureMode === 1 || structureMode === 2) {
    const dx = bytes.u16(at + AREA.structureWidth) * UNIT;
    const dy = bytes.u16(at + AREA.structureHeight) * UNIT;
    const elements = readElements(bytes, at + AREA.elements, bytes.u16(at + AREA.dataSize), end, warnings);
    if (elements.length > 0 && dx > 0 && dy > 0) pattern = { elements, dx, dy };
  }
  return { fill, hatches, pattern };
}

function textSymbol(bytes: Bytes, at: number): Pick<TextSymbol, "color" | "size" | "fontFamily" | "bold" | "italic"> {
  return {
    color: bytes.u16(at + TEXT.color),
    size: (bytes.u16(at + TEXT.fontSize) / 10) * POINT_PER_PT,
    fontFamily: bytes.pascal(at + TEXT.fontName, TEXT.fontNameCapacity) || "Arial",
    bold: bytes.u16(at + TEXT.fontWeight) >= 600,
    italic: bytes.u8(at + TEXT.italic) !== 0
  };
}

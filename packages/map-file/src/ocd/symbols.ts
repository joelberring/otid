/** OCAD-symboler → modellens symboler. Mått i OCAD är 0,01 mm, vinklar 0,1 grad, textstorlek 0,1 punkt. */
import { moveElement, normalizeAngle, normalizeHatchAngle, ocdSymbolCode } from "../geometry";
import type { AreaSymbol, HatchStyle, LineSymbol, MapSymbol, PointElement, StrokeStyle, TextSymbol } from "../model";
import type { WarningCollector } from "../warnings";
import { indexBlocks, type Bytes } from "./bytes";
import { coordsToParts, readCoords } from "./coords";
import {
  AREA, ELEMENT, ELEMENT_TYPE, LINE, LINE_SYMBOL_FLAG, POINT, RECTANGLE, SYMBOL, SYMBOL_BLOCK_SIZE, SYMBOL_TYPE, TEXT, UNIT,
  VARIANT_V12, type OcdVariant
} from "./layout";

const MAX_SYMBOLS = 100_000;
const MAX_SYMBOL_BYTES = 1 << 20;
const POINT_PER_PT = 25.4 / 72;
/** Fälten i `LINE`, `AREA` … räknas från denna position (version 12). */
const BODY_V12 = 796;

/** OCAD 8 sparar 101.2 som 1012; modellen använder version 9:s 101002. */
export function v8SymbolNumber(number: number): number {
  return Math.floor(number / 10) * 1000 + (number % 10);
}

export interface SymbolHead { readonly size: number; readonly number: number; readonly type: number }

export function readHead(bytes: Bytes, position: number, variant: OcdVariant): SymbolHead {
  if (variant.symbolHeader === "V8") {
    bytes.check(position, 6, "symbol");
    return { size: bytes.i16(position), number: v8SymbolNumber(bytes.i16(position + 2)), type: bytes.i16(position + 4) };
  }
  return { size: bytes.i32(position + SYMBOL.size), number: bytes.i32(position + SYMBOL.number), type: bytes.u8(position + SYMBOL.type) };
}

export function readOcdSymbols(bytes: Bytes, first: number, warnings: WarningCollector, variant: OcdVariant = VARIANT_V12): Map<string, MapSymbol> {
  const symbols = new Map<string, MapSymbol>();
  const borders = new Map<string, number>();
  if (first === 0) return symbols;
  // Typdelens fält läses från `position + shift + LINE.…` så att samma konstanter gäller alla versioner.
  const shift = variant.symbolBody - BODY_V12;
  const headerEnd = variant.symbolBody;
  for (const block of indexBlocks(bytes, first, SYMBOL_BLOCK_SIZE)) {
    for (let index = 0; index < 256; index++) {
      const position = bytes.i32(block + 4 + index * 4);
      if (position <= 0) continue;
      if (symbols.size >= MAX_SYMBOLS) break;
      const { size, number, type } = readHead(bytes, position, variant);
      if (size < headerEnd || size > MAX_SYMBOL_BYTES) { warnings.add("BROKEN_SYMBOL"); continue; }
      bytes.check(position, size, "symbol");
      const id = String(number);
      const description = variant.description.kind === "UTF16"
        ? bytes.utf16(position + variant.description.at, SYMBOL.descriptionBytes)
        : bytes.pascal(position + variant.description.at, 31);
      const base = { id, code: ocdSymbolCode(number), name: description, hidden: (bytes.u8(position + SYMBOL.status) & 2) !== 0 };
      // Symbolen ryms i filen (kontrollerat ovan). Är den kortare än typens fasta fält ritas den inte, men objekten behålls.
      const minimum = minimumSize(type, variant);
      const at = position + shift;
      let symbol: MapSymbol | null;
      if (minimum === undefined) symbol = null;
      else if (size - shift < minimum) { warnings.add("BROKEN_SYMBOL"); symbol = emptySymbol(type, base); }
      else symbol = convert(bytes, at, position + size, type, base, variant, warnings);
      if (!symbol) { warnings.add("UNKNOWN_SYMBOL_TYPE"); continue; }
      symbols.set(id, symbol);
      if (type === SYMBOL_TYPE.area && !variant.areaV8 && bytes.u8(at + AREA.borderOn) !== 0) {
        const border = bytes.i32(at + AREA.borderSymbol);
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
  return symbols;
}

/** Minsta storlek per symboltyp (räknat som i version 12) för att de fasta fälten ska rymmas. */
function minimumSize(type: number, variant: OcdVariant): number | undefined {
  switch (type) {
    case SYMBOL_TYPE.point: return POINT.elements;
    case SYMBOL_TYPE.line: return LINE.elements;
    case SYMBOL_TYPE.area: return variant.areaData.elements;
    case SYMBOL_TYPE.text:
    case SYMBOL_TYPE.lineText: return TEXT.italic + 2;
    case SYMBOL_TYPE.rectangle: return RECTANGLE.width + 2;
    default: return undefined;
  }
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

function convert(
  bytes: Bytes, at: number, end: number, type: number, base: Base, variant: OcdVariant, warnings: WarningCollector
): MapSymbol | null {
  switch (type) {
    case SYMBOL_TYPE.point: {
      const words = bytes.u16(at + POINT.dataSize);
      return { ...base, kind: "POINT", elements: readElements(bytes, at + POINT.elements, words, end, warnings) };
    }
    case SYMBOL_TYPE.line: return { ...base, kind: "LINE", ...lineSymbol(bytes, at, end, variant, warnings) };
    case SYMBOL_TYPE.area: return { ...base, kind: "AREA", ...areaSymbol(bytes, at, end, variant, warnings) };
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

function lineSymbol(
  bytes: Bytes, at: number, end: number, variant: OcdVariant, warnings: WarningCollector
): Pick<LineSymbol, "strokes" | "repeated" | "between" | "corner" | "start" | "end"> {
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

  return { strokes, ...lineDecorations(bytes, at, end, variant, warnings) };
}

/**
 * Linjesymbolens punktsymboler. Elementen ligger efter varandra: primär, sekundär, hörn, start och slut, var och en
 * med sin storlek i enheter om 8 byte. Sekundär-, hörn-, start- och slutsymbolen används bara när flaggan är satt.
 *
 * Primärsymbolen ligger i mitten av streckens mellanrum (eller med strecklängdens avstånd när linjen inte är streckad),
 * första och sista slutlängden in från ändarna; `symbolCount` symboler per ställe med `symbolDistance` emellan.
 */
function lineDecorations(
  bytes: Bytes, at: number, end: number, variant: OcdVariant, warnings: WarningCollector
): Pick<LineSymbol, "repeated" | "between" | "corner" | "start" | "end"> {
  // Före version 11 finns inga flaggor: en punktsymbol med ritdata används.
  const flags = variant.lineSymbolFlags ? bytes.u8(at + LINE.useSymbolFlags) : 0xff;
  const sizes = [LINE.primaryDataSize, LINE.secondaryDataSize, LINE.cornerDataSize, LINE.startDataSize, LINE.endDataSize]
    .map(offset => bytes.u16(at + offset));
  let position = at + LINE.elements;
  const groups = sizes.map(words => {
    const elements = words > 0 ? readElements(bytes, position, words, end, warnings) : [];
    position += words * 8;
    return elements;
  });
  const [primary, secondary, corner, start, finish] = groups as [PointElement[], PointElement[], PointElement[], PointElement[], PointElement[]];
  const mainLength = bytes.i16(at + LINE.mainLength) * UNIT;
  const mainGap = Math.max(0, bytes.i16(at + LINE.mainGap) * UNIT);
  const spacing = mainLength + mainGap;
  const count = bytes.i16(at + LINE.symbolCount);
  const along = {
    spacing,
    endLength: Math.max(0, bytes.i16(at + LINE.endLength) * UNIT) + mainGap / 2,
    // OCAD lägger alltid minst en symbol, även när filen säger noll.
    minimum: Math.max(1, bytes.i16(at + LINE.minimumSymbols) + 1)
  };
  const use = (elements: PointElement[], flag: number) => elements.length > 0 && (flags & flag) !== 0;
  return {
    repeated: primary.length > 0 && count > 0 && spacing > 0
      ? { elements: primary, ...along, count, groupSpacing: Math.max(0, bytes.i16(at + LINE.symbolDistance) * UNIT) }
      : undefined,
    between: use(secondary, LINE_SYMBOL_FLAG.secondary) && spacing > 0 ? { elements: secondary, ...along } : undefined,
    corner: use(corner, LINE_SYMBOL_FLAG.corner) ? { elements: corner, stretch: true } : undefined,
    start: use(start, LINE_SYMBOL_FLAG.start) ? { elements: start } : undefined,
    end: use(finish, LINE_SYMBOL_FLAG.end) ? { elements: finish } : undefined
  };
}

/**
 * Version 8 har ingen kantlinje: de fyra första byten är AreaFlags och FillOn (16 bit, vid 798) i stället för kantlinjens
 * nummer. Fyllningens färg, rastret och mönstret ligger på samma ställe i alla versioner.
 */
const AREA_V8_FILL_ON = 798;

function areaSymbol(
  bytes: Bytes, at: number, end: number, variant: OcdVariant, warnings: WarningCollector
): Pick<AreaSymbol, "fill" | "hatches" | "pattern"> {
  const fillOn = variant.areaV8 ? bytes.u16(at + AREA_V8_FILL_ON) !== 0 : bytes.u8(at + AREA.fillOn) !== 0;
  const fill = fillOn ? bytes.u16(at + AREA.fillColor) : undefined;
  const hatches: HatchStyle[] = [];
  const hatchMode = bytes.u16(at + AREA.hatchMode);
  if (hatchMode === 1 || hatchMode === 2) {
    const color = bytes.u16(at + AREA.hatchColor);
    const width = bytes.u16(at + AREA.hatchWidth) * UNIT;
    const spacing = bytes.u16(at + AREA.hatchDistance) * UNIT;
    const angles = [bytes.i16(at + AREA.hatchAngle1), ...(hatchMode === 2 ? [bytes.i16(at + AREA.hatchAngle2)] : [])];
    if (width > 0 && spacing > 0) for (const angle of angles) hatches.push({ color, width, spacing, angle: normalizeHatchAngle(angle / 10) });
  }
  // Mönster 1 = raka rader, 2 = varannan rad förskjuten en halv ruta. Det senare blir en dubbelt så hög ruta med
  // elementen två gånger, så att modellen bara behöver ett rakt rutnät.
  let pattern: AreaSymbol["pattern"];
  const structureMode = bytes.u8(at + AREA.structureMode);
  if (structureMode === 1 || structureMode === 2) {
    const dx = bytes.u16(at + AREA.structureWidth) * UNIT;
    const dy = bytes.u16(at + AREA.structureHeight) * UNIT;
    const elements = readElements(bytes, at + variant.areaData.elements, bytes.u16(at + variant.areaData.dataSize), end, warnings);
    const angle = normalizeAngle(bytes.i16(at + AREA.structureAngle) / 10);
    if (elements.length > 0 && dx > 0 && dy > 0) {
      pattern = structureMode === 1
        ? { elements, dx, dy, angle }
        : { elements: [...elements, ...elements.map(element => moveElement(element, dx / 2, -dy))], dx, dy: 2 * dy, angle };
    }
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

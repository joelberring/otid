/**
 * Binär serialiserare (clean-room) för OCAD-symboler (v9–2018+): `TPointSym`, `TLineSym`, `TAreaSym`, `TTextSym` och `TRectSym`.
 *
 * Konverterar både `SymbolDef` (O-Tids normmallar) och `MapSymbol` (modellens symboler) till kompletta OCAD-symbolposter med
 * korrekt `Extent`, `nColors` + `Colors[0..13]`, `Description` (UTF-16LE/Pascal) och 22×22 `IconBits`-miniatyr.
 */
import { normalizeAngle, ocdSymbolCode, openRing, parseSymbolCode } from "../../geometry";
import type {
  AreaSymbol, DashSpec, HatchStyle, LineSymbol, MapColor, MapSymbol, Path, PointElement, PointSymbol, StrokeStyle, TextSymbol
} from "../../model";
import type { ElementDef, SymbolDef } from "../../template/symbol-def";
import {
  AREA, COORD_FLAG, ELEMENT, ELEMENT_TYPE, LINE, LINE_SYMBOL_FLAG, POINT, RECTANGLE, SYMBOL, SYMBOL_TYPE, TEXT,
  type OcdVariant
} from "../layout";
import { encodeWindows1252, type OcdDocument, type RawOcdSymbol } from "./ocd-document";
import { computeSymbolExtentUnits, iconBitsOffset, renderOcdSymbolIcon, writeSymbolDescription, writeSymbolHeaderColors } from "./ocd-icon";

const BODY_V12 = 796;
const TEXT_BODY_SIZE = 240; // 796 + 240 = 1036 byte i OCAD v12/2018 (bekräftat mot Högdalen)
const RECT_BODY_SIZE = 16;
const POINT_PER_PT = 25.4 / 72;
const OCD_LIMIT = (1 << 23) - 1;

const unit = (mm: number): number => {
  const value = Math.round(mm * 100);
  return Math.max(-OCD_LIMIT, Math.min(OCD_LIMIT, value === 0 ? 0 : value));
};
const i16Clamp = (value: number): number => Math.max(-32768, Math.min(32767, Math.round(value)));
const u16Clamp = (value: number): number => Math.max(0, Math.min(65535, Math.round(value)));
const angleDeci = (deg: number): number => Math.round(normalizeAngle(deg) * 10) % 3600;

/** Konverterar symbolkod ("521", "521.1", "105.100") till OCAD-symbolnummer (`main * 1000 + sub`). */
export function parseOcdSymbolNumber(code: string): number | null {
  const match = /^\s*(\d{1,5})(?:\.(\d{1,3}))?\s*$/.exec(code);
  if (!match) return null;
  const main = Number(match[1]);
  const sub = match[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isInteger(main) || !Number.isInteger(sub) || main <= 0 || sub < 0 || sub > 999) return null;
  return main * 1000 + sub;
}

/** Sant om ett OCAD-symbolnummer matchar en symbolkod ("521" och "521.0" matchar båda 521000). */
export function ocdNumberMatchesCode(symNumber: number, code: string): boolean {
  if (!code) return false;
  const ocd = ocdSymbolCode(symNumber);
  if (ocd.text === code) return true;
  const parsed = parseSymbolCode(code);
  return parsed.main > 0 && ocd.main === parsed.main && ocd.sub === parsed.sub;
}

/** Hittar ett ledigt OCAD-symbolnummer utifrån en önskad kod (provar först exakt `main * 1000 + sub`, sedan lediga undernummer). */
export function allocateOcdSymbolNumber(doc: OcdDocument, code: string): number {
  const taken = new Set(doc.symbols.map(s => s.number));
  const exact = parseOcdSymbolNumber(code);
  if (exact !== null && !taken.has(exact)) return exact;
  const main = parseSymbolCode(code).main || 999;
  for (let sub = 1; sub <= 999; sub++) {
    const candidate = main * 1000 + sub;
    if (!taken.has(candidate)) return candidate;
  }
  let fallback = Math.max(900000, ...taken) + 1;
  while (taken.has(fallback)) fallback += 1;
  return fallback;
}

/** Hittar ett ledigt dolt hjälpsymbolnummer för en ytas `BorderSym`-linjesymbol (t.ex. `521.900`). */
export function allocateHelperBorderNumber(doc: OcdDocument, areaNumber: number): number {
  const taken = new Set(doc.symbols.map(s => s.number));
  const main = Math.floor(areaNumber / 1000);
  for (let sub = 900; sub <= 999; sub++) {
    const candidate = main * 1000 + sub;
    if (candidate > 0 && !taken.has(candidate)) return candidate;
  }
  for (let sub = 1; sub <= 899; sub++) {
    const candidate = main * 1000 + sub;
    if (candidate > 0 && !taken.has(candidate)) return candidate;
  }
  let fallback = Math.max(950000, ...taken) + 1;
  while (taken.has(fallback)) fallback += 1;
  return fallback;
}

function lineStyleCode(cap: StrokeStyle["cap"], join: StrokeStyle["join"]): number {
  if (cap === "round" && join === "round") return 1;
  if (join === "round") return 2;
  if (join === "miter") return 4;
  return 0;
}

function encodeCoords(points: readonly { x: number; y: number; xf: number; yf: number }[]): Uint8Array {
  const out = new Uint8Array(points.length * 8);
  const view = new DataView(out.buffer);
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    view.setInt32(i * 8, (p.x << 8) | (p.xf & 0xff), true);
    view.setInt32(i * 8 + 4, (p.y << 8) | (p.yf & 0xff), true);
  }
  return out;
}

function pathToRawCoords(paths: readonly Path[], area: boolean): { x: number; y: number; xf: number; yf: number }[] {
  const out: { x: number; y: number; xf: number; yf: number }[] = [];
  paths.forEach((rawPath, ringIdx) => {
    const path = area ? openRing(rawPath) : rawPath;
    for (const cmd of path) {
      if (cmd.type === "M") {
        out.push({ x: unit(cmd.x), y: unit(cmd.y), xf: 0, yf: area && ringIdx > 0 ? COORD_FLAG.holeStart : 0 });
      } else if (cmd.type === "C") {
        out.push(
          { x: unit(cmd.x1), y: unit(cmd.y1), xf: COORD_FLAG.firstControl, yf: 0 },
          { x: unit(cmd.x2), y: unit(cmd.y2), xf: COORD_FLAG.secondControl, yf: 0 },
          { x: unit(cmd.x), y: unit(cmd.y), xf: 0, yf: 0 }
        );
      } else {
        out.push({ x: unit(cmd.x), y: unit(cmd.y), xf: 0, yf: 0 });
      }
    }
  });
  return out;
}

/** Serialiserar en lista `PointElement` till sammanhängande OCAD `TSymElt`-poster (alltid en multipel av 8 byte). */
export function encodeOcdElements(elements: readonly PointElement[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const el of elements) {
    let type: number;
    let flags = 0;
    let lineWidth = 0;
    let diameter = 0;
    let coords: { x: number; y: number; xf: number; yf: number }[];
    if (el.kind === "dot") {
      type = ELEMENT_TYPE.dot;
      diameter = i16Clamp(unit(el.diameter));
      coords = [{ x: unit(el.center.x), y: unit(el.center.y), xf: 0, yf: 0 }];
    } else if (el.kind === "circle") {
      type = ELEMENT_TYPE.circle;
      lineWidth = i16Clamp(unit(el.lineWidth));
      diameter = i16Clamp(unit(el.diameter));
      coords = [{ x: unit(el.center.x), y: unit(el.center.y), xf: 0, yf: 0 }];
    } else if (el.kind === "line") {
      type = ELEMENT_TYPE.line;
      flags = lineStyleCode(el.cap, el.join);
      lineWidth = i16Clamp(unit(el.width));
      coords = pathToRawCoords([el.path], false);
      if (coords.length < 2) continue;
    } else {
      type = ELEMENT_TYPE.area;
      coords = pathToRawCoords(el.rings, true);
      if (coords.length < 3) continue;
    }
    const buf = new Uint8Array(ELEMENT.header + coords.length * 8);
    const view = new DataView(buf.buffer);
    view.setUint16(ELEMENT.type, type, true);
    view.setUint16(ELEMENT.flags, flags, true);
    view.setUint16(ELEMENT.color, u16Clamp(el.color), true);
    view.setInt16(ELEMENT.lineWidth, lineWidth, true);
    view.setInt16(ELEMENT.diameter, diameter, true);
    view.setUint16(ELEMENT.coordCount, coords.length, true);
    buf.set(encodeCoords(coords), ELEMENT.header);
    chunks.push(buf);
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

function elementDefToPointElement(el: ElementDef, factor: number, colorIds: ReadonlyMap<string, number>): PointElement {
  const color = colorIds.get(el.color) ?? 0;
  const s = (v: number) => v * factor;
  if (el.kind === "dot") {
    return { kind: "dot", color, center: { x: s(el.at?.[0] ?? 0), y: s(el.at?.[1] ?? 0) }, diameter: s(el.diameter) };
  }
  if (el.kind === "ring") {
    // I SymbolDef anger `ring(color, diameter, width)` ytterdiameter; OCAD/MapSymbol `circle` anger mittlinjediameter.
    const centerDiam = Math.max(el.width, el.diameter - el.width);
    return { kind: "circle", color, center: { x: s(el.at?.[0] ?? 0), y: s(el.at?.[1] ?? 0) }, diameter: s(centerDiam), lineWidth: s(el.width) };
  }
  if (el.kind === "line") {
    const path = el.points.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x: s(x), y: s(y) }));
    return { kind: "line", color, width: s(el.width), path, cap: el.round ? "round" : "butt", join: "miter" };
  }
  const ring = el.points.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x: s(x), y: s(y) }));
  return { kind: "area", color, rings: [ring] };
}

/** Konverterar O-Tids `SymbolDef` (normsymbol) till `MapSymbol` + ev. `staggered`- och `rotatable`-flaggor. */
export function symbolDefToMapSymbol(
  def: SymbolDef,
  number: number,
  factor: number,
  colorIds: ReadonlyMap<string, number>,
  overrideName?: string
): { readonly symbol: MapSymbol; readonly rotatable: boolean; readonly staggered: boolean; readonly borderLine?: LineSymbol } {
  const base = { id: String(number), code: ocdSymbolCode(number), name: overrideName ?? def.name, hidden: false };
  const s = (v: number) => v * factor;
  const col = (key: string) => colorIds.get(key) ?? 0;

  if (def.kind === "point") {
    const symbol: PointSymbol = { ...base, kind: "POINT", elements: def.elements.map(el => elementDefToPointElement(el, factor, colorIds)) };
    return { symbol, rotatable: def.rotatable === true, staggered: false };
  }

  if (def.kind === "text") {
    const symbol: TextSymbol = {
      ...base, kind: "TEXT", color: col(def.color), size: s(def.size), fontFamily: "Arial",
      bold: def.bold === true, italic: def.italic === true
    };
    return { symbol, rotatable: true, staggered: false };
  }

  if (def.kind === "line") {
    const strokes: StrokeStyle[] = [];
    const cap = def.cap ?? "butt";
    const join = def.join ?? "miter";
    const buildDash = (
      rawDash: readonly [number, number] | undefined,
      dashGroup?: { readonly count: number; readonly breakLength: number },
      halfOuterDashes?: boolean
    ): { dash?: readonly number[]; dashSpec?: DashSpec } => {
      if (!rawDash) return {};
      const dashLen = s(rawDash[0]);
      const gap = s(rawDash[1]);
      const grouped = (dashGroup?.count ?? 1) >= 2;
      const inGroup = dashGroup ? s(dashGroup.breakLength) : 0;
      const mainLength = grouped ? 2 * dashLen + inGroup : dashLen;
      const halfOuter = halfOuterDashes ?? true;
      const dash = grouped ? [dashLen, inGroup, dashLen, gap] : [dashLen, gap];
      const dashSpec: DashSpec = {
        mainLength,
        mainGap: gap,
        endLength: halfOuter ? mainLength / 2 : mainLength,
        ...(grouped && inGroup > 0 ? { secondaryGap: inGroup } : {})
      };
      return { dash, dashSpec };
    };
    if (def.border) {
      const bandWidth = s(def.width ?? 0);
      const shift = s(def.border.shift ?? def.border.width / 2);
      const dblWidth = bandWidth + 2 * shift;
      const bWidth = s(def.border.width);
      const bDash = def.border.dash ? [s(def.border.dash[0]), s(def.border.dash[1])] as const : undefined;
      if (def.color && bandWidth > 0) {
        strokes.push({ color: col(def.color), width: bandWidth, cap, join, ...buildDash(def.dash, def.dashGroup, def.halfOuterDashes) });
      }
      strokes.push(
        { color: col(def.border.color), width: bWidth, offset: dblWidth / 2, cap, join, ...(bDash ? { dash: bDash } : {}) },
        { color: col(def.border.color), width: bWidth, offset: -dblWidth / 2, cap, join, ...(bDash ? { dash: bDash } : {}) }
      );
    } else if (def.color && def.width && def.width > 0) {
      strokes.push({ color: col(def.color), width: s(def.width), cap, join, ...buildDash(def.dash, def.dashGroup, def.halfOuterDashes) });
    }
    const repeated = def.mid
      ? {
          elements: def.mid.elements.map(el => elementDefToPointElement(el, factor, colorIds)),
          spacing: s(def.mid.spacing),
          endLength: s(def.mid.end ?? def.mid.spacing / 2),
          count: Math.max(1, def.mid.count ?? 1),
          ...(def.mid.groupSpacing ? { groupSpacing: s(def.mid.groupSpacing) } : {}),
          minimum: Math.max(1, def.mid.minimum ?? 1)
        }
      : undefined;
    const corner = def.corner && def.corner.elements.length > 0
      ? {
          elements: def.corner.elements.map(el => elementDefToPointElement(el, factor, colorIds)),
          stretch: def.corner.stretch !== false,
          ...(def.corner.skipEnds ? { skipEnds: true as const } : {})
        }
      : undefined;
    const start = def.start && def.start.length > 0
      ? { elements: def.start.map(el => elementDefToPointElement(el, factor, colorIds)) }
      : undefined;
    const end = def.end && def.end.length > 0
      ? { elements: def.end.map(el => elementDefToPointElement(el, factor, colorIds)) }
      : undefined;
    const symbol: LineSymbol = {
      ...base,
      kind: "LINE",
      strokes,
      ...(repeated ? { repeated } : {}),
      ...(corner ? { corner } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {})
    };
    return { symbol, rotatable: false, staggered: false };
  }

  // kind === "area"
  const hatches: HatchStyle[] = (def.hatches ?? []).map(h => ({
    color: col(h.color), width: s(h.width), spacing: s(h.spacing), angle: normalizeAngle(h.angle ?? 0)
  }));
  const pattern = def.dots
    ? {
        elements: def.dots.elements.map(el => elementDefToPointElement(el, factor, colorIds)),
        dx: s(def.dots.dx),
        dy: s(def.dots.dy),
        angle: normalizeAngle(def.dots.angle ?? 0)
      }
    : undefined;
  const borderStrokes = def.border ? [{ color: col(def.border.color), width: s(def.border.width), join: "miter" as const }] : undefined;
  const symbol: AreaSymbol = {
    ...base, kind: "AREA",
    ...(def.fill ? { fill: col(def.fill) } : {}),
    hatches,
    ...(pattern ? { pattern } : {}),
    ...(borderStrokes ? { border: borderStrokes } : {})
  };
  const borderLine: LineSymbol | undefined = borderStrokes
    ? { id: "", code: ocdSymbolCode(0), name: `${base.name} (kant)`, hidden: true, kind: "LINE", strokes: borderStrokes }
    : undefined;
  return { symbol, rotatable: false, staggered: def.dots?.staggered === true, ...(borderLine ? { borderLine } : {}) };
}

function collectSymbolColors(symbol: MapSymbol): number[] {
  const colors: number[] = [];
  const add = (c: number | undefined) => { if (c !== undefined && c >= 0) colors.push(c); };
  switch (symbol.kind) {
    case "POINT":
      for (const el of symbol.elements) add(el.color);
      break;
    case "LINE":
      for (const st of symbol.strokes) add(st.color);
      for (const g of [symbol.repeated, symbol.between, symbol.corner, symbol.start, symbol.end]) {
        for (const el of g?.elements ?? []) add(el.color);
      }
      break;
    case "AREA":
      add(symbol.fill);
      for (const h of symbol.hatches) add(h.color);
      for (const el of symbol.pattern?.elements ?? []) add(el.color);
      for (const b of symbol.border ?? []) add(b.color);
      break;
    case "TEXT":
      add(symbol.color);
      if (symbol.framing) add(symbol.framing.color);
      break;
    case "COMBINED":
      break;
  }
  return colors;
}

export interface EncodeOcdSymbolOptions {
  readonly number: number;
  readonly variant: OcdVariant;
  readonly colors: readonly MapColor[];
  readonly status?: number | undefined;
  readonly rotatable?: boolean | undefined;
  readonly staggered?: boolean | undefined;
  /** För `AREA` med kantlinje: OCAD-symbolnumret för den separata `BorderSym`-linjesymbolen. */
  readonly borderSymbolNumber?: number | undefined;
}

/** Skriver en komplett OCAD-symbolpost (`TBaseSym` + typkropp) för v9–2018+ utifrån en `MapSymbol`. */
export function encodeOcdSymbol(symbol: MapSymbol, options: EncodeOcdSymbolOptions): RawOcdSymbol {
  const { variant, number } = options;
  const shift = variant.symbolBody - BODY_V12;
  const body = buildSymbolBody(symbol, variant, options.staggered === true, options.borderSymbolNumber);
  const type = symbol.kind === "POINT" ? SYMBOL_TYPE.point
    : symbol.kind === "LINE" ? (symbol.rectangle ? SYMBOL_TYPE.rectangle : SYMBOL_TYPE.line)
    : symbol.kind === "AREA" ? SYMBOL_TYPE.area
    : symbol.kind === "TEXT" ? (symbol.lineText ? SYMBOL_TYPE.lineText : SYMBOL_TYPE.text)
    : SYMBOL_TYPE.point;
  const totalSize = variant.symbolBody + body.length;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  const status = options.status ?? (symbol.hidden ? 2 : 0);

  view.setInt32(SYMBOL.size, totalSize, true);
  view.setInt32(SYMBOL.number, number, true);
  view.setUint8(SYMBOL.type, type);
  view.setUint8(SYMBOL.flags, options.rotatable ? 1 : 0);
  view.setUint8(SYMBOL.status, status);
  view.setInt32(SYMBOL.extent, computeSymbolExtentUnits(symbol), true);
  writeSymbolHeaderColors(out, collectSymbolColors(symbol));
  writeSymbolDescription(out, symbol.name, variant);
  out.set(renderOcdSymbolIcon(symbol, options.colors), iconBitsOffset(variant));
  out.set(body, BODY_V12 + shift);

  return { number, type, status, filePos: 0, bytes: out };
}

function buildSymbolBody(symbol: MapSymbol, variant: OcdVariant, staggered: boolean, borderSymbolNumber?: number): Uint8Array {
  if (symbol.kind === "POINT") {
    const elBytes = encodeOcdElements(symbol.elements);
    const body = new Uint8Array(4 + elBytes.length);
    const view = new DataView(body.buffer);
    view.setUint16(POINT.dataSize - BODY_V12, elBytes.length / 8, true);
    body.set(elBytes, POINT.elements - BODY_V12);
    return body;
  }

  if (symbol.kind === "LINE" && symbol.rectangle) {
    const body = new Uint8Array(RECT_BODY_SIZE);
    const view = new DataView(body.buffer);
    const first = symbol.strokes[0];
    view.setInt16(RECTANGLE.color - BODY_V12, first ? i16Clamp(first.color) : 0, true);
    view.setInt16(RECTANGLE.width - BODY_V12, first ? i16Clamp(unit(first.width)) : 0, true);
    return body;
  }

  if (symbol.kind === "LINE") {
    return buildLineBody(symbol, variant);
  }

  if (symbol.kind === "AREA") {
    return buildAreaBody(symbol, variant, staggered, borderSymbolNumber);
  }

  if (symbol.kind === "TEXT") {
    const body = new Uint8Array(TEXT_BODY_SIZE);
    const view = new DataView(body.buffer);
    writeTextBodyFields(body, view, 0, symbol);
    return body;
  }

  return new Uint8Array(0);
}

/** Skriver fälten i `TTextSym`-kroppen (börjar vid offset `base`, dvs `0` för fristående kropp eller `symbolBody` i hel symbol). */
export function writeTextBodyFields(buf: Uint8Array, view: DataView, base: number, symbol: TextSymbol): void {
  const fontEncoded = encodeWindows1252(symbol.fontFamily || "Arial").subarray(0, TEXT.fontNameCapacity);
  buf.fill(0, base, base + TEXT.fontNameCapacity + 1);
  buf[base] = fontEncoded.length;
  buf.set(fontEncoded, base + 1);
  view.setInt16(base + (TEXT.color - BODY_V12), i16Clamp(symbol.color), true);
  view.setInt16(base + (TEXT.fontSize - BODY_V12), i16Clamp(Math.round((symbol.size / POINT_PER_PT) * 10)), true);
  view.setInt16(base + (TEXT.fontWeight - BODY_V12), symbol.bold ? 700 : 400, true);
  view.setUint8(base + (TEXT.italic - BODY_V12), symbol.italic ? 1 : 0);
  // WordSpace = 100 (offset 838) om 0.
  if (view.getInt16(base + (838 - BODY_V12), true) === 0) view.setInt16(base + (838 - BODY_V12), 100, true);
  const h = symbol.align === "center" ? 1 : symbol.align === "right" ? 2 : 0;
  const v = symbol.baseline === "middle" ? 1 : symbol.baseline === "top" ? 2 : 0;
  view.setUint16(base + (TEXT.alignment - BODY_V12), h | (v << 2), true);
  view.setInt16(base + (TEXT.lineSpace - BODY_V12), i16Clamp(Math.round((symbol.lineSpacing ?? 1.2) * 100)), true);
  if (base + (TEXT.framingEnd - BODY_V12) <= buf.length) {
    if (symbol.framing && symbol.framing.width > 0) {
      view.setUint8(base + (TEXT.frMode - BODY_V12), 2);
      view.setUint8(base + (991 - BODY_V12), 4); // FrLineStyle = miter
      view.setInt16(base + (TEXT.frColor - BODY_V12), i16Clamp(symbol.framing.color), true);
      view.setInt16(base + (TEXT.frWidth - BODY_V12), i16Clamp(unit(symbol.framing.width / 2)), true);
    } else {
      view.setUint8(base + (TEXT.frMode - BODY_V12), 0);
      view.setInt16(base + (TEXT.frColor - BODY_V12), 0, true);
      view.setInt16(base + (TEXT.frWidth - BODY_V12), 0, true);
    }
  }
}

function buildLineBody(symbol: LineSymbol, variant: OcdVariant): Uint8Array {
  const leftStroke = symbol.strokes.find(s => (s.offset ?? 0) > 0);
  const rightStroke = symbol.strokes.find(s => (s.offset ?? 0) < 0);
  const centerStrokes = symbol.strokes.filter(s => !s.offset);
  const hasDouble = Boolean(leftStroke || rightStroke);
  const dblWidthMm = leftStroke && rightStroke ? Math.abs(leftStroke.offset!) + Math.abs(rightStroke.offset!)
    : leftStroke ? Math.abs(leftStroke.offset!) * 2
    : rightStroke ? Math.abs(rightStroke.offset!) * 2 : 0;

  // Om dubbellinje finns och en mittlinje har exakt samma bredd som dubbellinjen blir den `DblFillColor`; annars `LineColor`.
  let mainStroke: StrokeStyle | undefined;
  let fillStroke: StrokeStyle | undefined;
  let framingStroke: StrokeStyle | undefined;
  if (hasDouble && centerStrokes.length > 0) {
    const first = centerStrokes[0]!;
    if (Math.abs(first.width - dblWidthMm) < 0.005) {
      fillStroke = first;
      mainStroke = centerStrokes[1];
    } else {
      mainStroke = first;
    }
  } else if (centerStrokes.length >= 2) {
    framingStroke = centerStrokes[0];
    mainStroke = centerStrokes[1];
  } else {
    mainStroke = centerStrokes[0];
  }

  const primaryBytes = symbol.repeated ? encodeOcdElements(symbol.repeated.elements) : new Uint8Array(0);
  const secondaryBytes = symbol.between ? encodeOcdElements(symbol.between.elements) : new Uint8Array(0);
  const cornerBytes = symbol.corner ? encodeOcdElements(symbol.corner.elements) : new Uint8Array(0);
  const startBytes = symbol.start ? encodeOcdElements(symbol.start.elements) : new Uint8Array(0);
  const endBytes = symbol.end ? encodeOcdElements(symbol.end.elements) : new Uint8Array(0);

  const headerSize = LINE.elements - BODY_V12;
  const totalElements = primaryBytes.length + secondaryBytes.length + cornerBytes.length + startBytes.length + endBytes.length;
  const body = new Uint8Array(headerSize + totalElements);
  const view = new DataView(body.buffer);
  const set16 = (off: number, val: number) => view.setInt16(off - BODY_V12, i16Clamp(val), true);
  const setU16 = (off: number, val: number) => view.setUint16(off - BODY_V12, u16Clamp(val), true);

  set16(LINE.color, mainStroke ? mainStroke.color : -1);
  set16(LINE.width, mainStroke ? unit(mainStroke.width) : 0);
  setU16(LINE.style, lineStyleCode(mainStroke?.cap ?? fillStroke?.cap ?? leftStroke?.cap, mainStroke?.join ?? fillStroke?.join ?? leftStroke?.join));

  // Streckning och primär punktsymbol delar `MainLength`/`EndLength`/`MainGap`.
  const dashSpec = mainStroke?.dashSpec;
  const dash = mainStroke?.dash;
  let mainLen = 0, mainGap = 0, endLen = 0, secGap = 0;
  if (dashSpec) {
    mainLen = unit(dashSpec.mainLength);
    mainGap = unit(dashSpec.mainGap);
    endLen = unit(dashSpec.endLength);
    secGap = unit(dashSpec.secondaryGap ?? 0);
  } else if (dash && dash.length >= 2) {
    mainLen = unit(dash[0]!);
    mainGap = unit(dash[1]!);
    endLen = Math.round(mainLen / 2);
  } else if (symbol.repeated) {
    mainLen = unit(symbol.repeated.spacing);
    endLen = unit(symbol.repeated.endLength ?? symbol.repeated.spacing / 2);
  } else if (symbol.between) {
    mainLen = unit(symbol.between.spacing);
    endLen = unit(symbol.between.endLength ?? symbol.between.spacing / 2);
  }
  set16(LINE.mainLength, mainLen);
  set16(LINE.endLength, endLen);
  set16(LINE.mainGap, mainGap);
  set16(LINE.secondaryGap, secGap);

  if (symbol.repeated) {
    set16(LINE.minimumSymbols, Math.max(0, (symbol.repeated.minimum ?? 1) - 1));
    set16(LINE.symbolCount, Math.max(1, symbol.repeated.count ?? 1));
    set16(LINE.symbolDistance, unit(symbol.repeated.groupSpacing ?? 0));
  }

  if (hasDouble) {
    const leftDashed = Boolean(leftStroke?.dash && leftStroke.dash.length >= 2);
    const rightDashed = Boolean(rightStroke?.dash && rightStroke.dash.length >= 2);
    const fillDashed = Boolean(fillStroke?.dash && fillStroke.dash.length >= 2);
    const dblMode = fillDashed ? 4 : leftDashed && rightDashed ? 3 : leftDashed ? 2 : 1;
    setU16(LINE.doubleMode, dblMode);
    setU16(LINE.doubleFlags, fillStroke ? 1 : 0);
    set16(LINE.doubleColor, fillStroke ? fillStroke.color : -1);
    set16(LINE.doubleLeftColor, leftStroke ? leftStroke.color : -1);
    set16(LINE.doubleRightColor, rightStroke ? rightStroke.color : -1);
    set16(LINE.doubleWidth, unit(dblWidthMm));
    set16(LINE.doubleLeftWidth, leftStroke ? unit(leftStroke.width) : 0);
    set16(LINE.doubleRightWidth, rightStroke ? unit(rightStroke.width) : 0);
    const dblDash = leftStroke?.dash ?? rightStroke?.dash ?? fillStroke?.dash;
    if (dblDash && dblDash.length >= 2) {
      set16(LINE.doubleLength, unit(dblDash[0]!));
      set16(LINE.doubleGap, unit(dblDash[1]!));
    }
  }

  set16(LINE.framingColor, framingStroke ? framingStroke.color : -1);
  set16(LINE.framingWidth, framingStroke ? unit(framingStroke.width) : 0);
  setU16(LINE.framingStyle, framingStroke ? lineStyleCode(framingStroke.cap, framingStroke.join) : 0);

  setU16(LINE.primaryDataSize, primaryBytes.length / 8);
  setU16(LINE.secondaryDataSize, secondaryBytes.length / 8);
  setU16(LINE.cornerDataSize, cornerBytes.length / 8);
  setU16(LINE.startDataSize, startBytes.length / 8);
  setU16(LINE.endDataSize, endBytes.length / 8);
  if (variant.lineSymbolFlags) {
    const flags =
      (endBytes.length > 0 ? LINE_SYMBOL_FLAG.end : 0) |
      (startBytes.length > 0 ? LINE_SYMBOL_FLAG.start : 0) |
      (cornerBytes.length > 0 ? LINE_SYMBOL_FLAG.corner : 0) |
      (secondaryBytes.length > 0 ? LINE_SYMBOL_FLAG.secondary : 0);
    view.setUint8(LINE.useSymbolFlags - BODY_V12, flags);
  }

  let cursor = headerSize;
  for (const part of [primaryBytes, secondaryBytes, cornerBytes, startBytes, endBytes]) {
    body.set(part, cursor);
    cursor += part.length;
  }
  return body;
}

function buildAreaBody(symbol: AreaSymbol, variant: OcdVariant, staggered: boolean, borderSymbolNumber?: number): Uint8Array {
  const elBytes = symbol.pattern ? encodeOcdElements(symbol.pattern.elements) : new Uint8Array(0);
  const headerSize = variant.areaData.elements - BODY_V12;
  const body = new Uint8Array(headerSize + elBytes.length);
  const view = new DataView(body.buffer);

  if (borderSymbolNumber && borderSymbolNumber > 0) {
    view.setInt32(AREA.borderSymbol - BODY_V12, borderSymbolNumber, true);
    view.setUint8(AREA.borderOn - BODY_V12, 1);
  }
  if (symbol.fill !== undefined) {
    view.setUint16(AREA.fillColor - BODY_V12, u16Clamp(symbol.fill), true);
    view.setUint8(AREA.fillOn - BODY_V12, 1);
  }
  if (symbol.hatches.length > 0) {
    const h1 = symbol.hatches[0]!;
    const h2 = symbol.hatches[1];
    view.setUint16(AREA.hatchMode - BODY_V12, h2 ? 2 : 1, true);
    view.setUint16(AREA.hatchColor - BODY_V12, u16Clamp(h1.color), true);
    view.setUint16(AREA.hatchWidth - BODY_V12, u16Clamp(unit(h1.width)), true);
    view.setUint16(AREA.hatchDistance - BODY_V12, u16Clamp(unit(h1.spacing)), true);
    view.setInt16(AREA.hatchAngle1 - BODY_V12, i16Clamp(angleDeci(h1.angle)), true);
    if (h2) view.setInt16(AREA.hatchAngle2 - BODY_V12, i16Clamp(angleDeci(h2.angle)), true);
  }
  if (symbol.pattern && elBytes.length > 0) {
    view.setUint8(AREA.structureMode - BODY_V12, staggered ? 2 : 1);
    view.setUint16(AREA.structureWidth - BODY_V12, u16Clamp(unit(symbol.pattern.dx)), true);
    view.setUint16(AREA.structureHeight - BODY_V12, u16Clamp(unit(symbol.pattern.dy)), true);
    view.setInt16(AREA.structureAngle - BODY_V12, i16Clamp(angleDeci(symbol.pattern.angle ?? 0)), true);
    if (symbol.pattern.irregular && variant.areaData.dataSize >= AREA.dataSize) {
      view.setUint8(AREA.structureDraw - BODY_V12, 3);
      const varX = Math.min(255, Math.round((symbol.pattern.irregular.jitterX * 2 / symbol.pattern.dx) * 100));
      const varY = Math.min(255, Math.round((symbol.pattern.irregular.jitterY * 2 / symbol.pattern.dy) * 100));
      view.setUint8(AREA.structureVarX - BODY_V12, varX);
      view.setUint8(AREA.structureVarY - BODY_V12, varY);
      view.setUint16(AREA.structureMinDist - BODY_V12, u16Clamp(unit(symbol.pattern.irregular.minDist ?? 0)), true);
    }
    view.setUint16(variant.areaData.dataSize - BODY_V12, elBytes.length / 8, true);
    body.set(elBytes, headerSize);
  }
  return body;
}

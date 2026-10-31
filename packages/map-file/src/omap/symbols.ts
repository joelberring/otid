/** Mapper-symboler (`<symbol type=…>`) → modellens symboler. Mått i Mapper är 0,001 mm. */
import { moveCommand, moveElement, NO_CODE, normalizeAngle, normalizeHatchAngle, parseSymbolCode } from "../geometry";
import type { AreaSymbol, HatchStyle, LineSymbol, MapSymbol, PointElement, StrokeStyle, TextSymbol } from "../model";
import type { WarningCollector } from "../warnings";
import { coordsToParts, parseCoordText } from "./coords";
import { asArray, attr, bool, child, num, text, type XmlNode } from "./xml";

const UM = 1 / 1000;
const DEG = 180 / Math.PI;

export interface OmapSymbols {
  readonly symbols: Map<string, MapSymbol>;
  /** Symbolen innehåller en yta (direkt eller via delar) → objekten är ytor. */
  readonly isArea: (id: string) => boolean;
}

export function readOmapSymbols(symbolNodes: readonly XmlNode[], warnings: WarningCollector): OmapSymbols {
  const symbols = new Map<string, MapSymbol>();
  symbolNodes.forEach((node, index) => {
    const id = attr(node, "id") ?? String(index);
    const symbol = convertSymbol(node, id, bool(node, "is_hidden"), symbols, warnings);
    if (symbol) symbols.set(id, symbol);
  });
  const areaCache = new Map<string, boolean>();
  const isArea = (id: string, depth = 0): boolean => {
    const cached = areaCache.get(id);
    if (cached !== undefined) return cached;
    const symbol = symbols.get(id);
    let result = false;
    if (symbol?.kind === "AREA") result = true;
    else if (symbol?.kind === "COMBINED" && depth < 8) result = symbol.parts.some(part => isArea(part, depth + 1));
    areaCache.set(id, result);
    return result;
  };
  return { symbols, isArea: id => isArea(id) };
}

function convertSymbol(
  node: XmlNode, id: string, hidden: boolean, symbols: Map<string, MapSymbol>, warnings: WarningCollector
): MapSymbol | null {
  const base = { id, code: codeOf(node), name: attr(node, "name") ?? "", hidden };
  switch (attr(node, "type")) {
    case "1": return { ...base, kind: "POINT", elements: pointElements(child(node, "point_symbol")) };
    case "2": return { ...base, kind: "LINE", ...lineSymbol(child(node, "line_symbol")) };
    case "4": return { ...base, kind: "AREA", ...areaSymbol(child(node, "area_symbol")) };
    case "8": return { ...base, kind: "TEXT", ...textSymbol(child(node, "text_symbol")) };
    case "16": {
      const parts: string[] = [];
      asArray(child(node, "combined_symbol")?.part).forEach((part, index) => {
        const ref = attr(part, "symbol");
        if (ref !== undefined && attr(part, "private") !== "true") { parts.push(ref); return; }
        const inner = child(part, "symbol");
        if (!inner) return;
        // Privata delar finns bara inuti den kombinerade symbolen; de får ett eget id i symboltabellen.
        const partId = `${id}.${index}`;
        const symbol = convertSymbol(inner, partId, hidden, symbols, warnings);
        if (symbol) { symbols.set(partId, symbol); parts.push(partId); }
      });
      return { ...base, kind: "COMBINED", parts };
    }
    default:
      warnings.add("UNKNOWN_SYMBOL_TYPE");
      return null;
  }
}

function codeOf(node: XmlNode) {
  const code = attr(node, "code");
  return code ? parseSymbolCode(code) : NO_CODE;
}

function color(node: XmlNode | undefined, name: string): number | null {
  const value = num(node, name, -1);
  return value >= 0 ? value : null;
}

function capOf(node: XmlNode | undefined): StrokeStyle["cap"] {
  switch (attr(node, "cap_style")) {
    case "1": return "round";
    case "2": return "square";
    default: return "butt";
  }
}

function joinOf(node: XmlNode | undefined): StrokeStyle["join"] {
  switch (attr(node, "join_style")) {
    case "0": return "bevel";
    case "2": return "round";
    default: return "miter";
  }
}

function lineSymbol(line: XmlNode | undefined): Pick<LineSymbol, "strokes" | "repeated"> {
  const strokes: StrokeStyle[] = [];
  const width = num(line, "line_width", 0) * UM;
  const main = color(line, "color");
  const cap = capOf(line);
  const join = joinOf(line);
  if (main !== null && width > 0) {
    let dash: number[] | undefined;
    if (bool(line, "dashed")) {
      const length = num(line, "dash_length", 4000) * UM;
      const gap = num(line, "break_length", 1000) * UM;
      dash = num(line, "dashes_in_group", 1) >= 2
        ? [length, num(line, "in_group_break_length", 500) * UM, length, gap]
        : [length, gap];
    }
    strokes.push({ color: main, width, cap, join, dash });
  }
  // En kantlinje gäller båda sidor; två kantlinjer är vänster och höger. "shift" flyttar kantlinjen inåt.
  const borders = asArray(child(line, "borders")?.border);
  borders.slice(0, 2).forEach((border, index) => {
    const borderColor = color(border, "color");
    const borderWidth = num(border, "width", 0) * UM;
    if (borderColor === null || borderWidth <= 0) return;
    const offset = width / 2 + borderWidth / 2 - num(border, "shift", 0) * UM;
    const sides = borders.length === 1 ? [offset, -offset] : [index === 0 ? offset : -offset];
    for (const side of sides) strokes.push({ color: borderColor, width: borderWidth, offset: side, join });
  });
  const mid = child(child(line, "mid_symbol"), "symbol");
  const spacing = num(line, "segment_length", 0) * UM;
  const elements = mid ? pointElements(child(mid, "point_symbol")) : [];
  return { strokes, repeated: elements.length > 0 && spacing > 0 ? { elements, spacing } : undefined };
}

/**
 * Ytans mönster. Linjemönster blir raster. Punktmönster med samma vinkel och rutstorlek slås ihop till en ruta med
 * flera element (Mapper skriver OCAD:s förskjutna rader som två mönster med förskjutning); övriga punktmönster hoppas över.
 */
function areaSymbol(area: XmlNode | undefined): Pick<AreaSymbol, "fill" | "hatches" | "pattern" | "border"> {
  const hatches: HatchStyle[] = [];
  let pattern: { elements: PointElement[]; dx: number; dy: number; angle: number } | undefined;
  for (const node of asArray(area?.pattern)) {
    const radians = num(node, "angle", 0);
    const spacing = num(node, "line_spacing", 0) * UM;
    if (attr(node, "type") === "1") {
      const hatchColor = color(node, "color");
      const width = num(node, "line_width", 0) * UM;
      if (hatchColor !== null && width > 0 && spacing > 0) {
        hatches.push({ color: hatchColor, width, spacing, angle: normalizeHatchAngle(radians * DEG) });
      }
    } else if (attr(node, "type") === "2") {
      const elements = pointElements(child(child(node, "symbol"), "point_symbol"));
      const dx = num(node, "point_distance", 0) * UM;
      if (elements.length === 0 || dx <= 0 || spacing <= 0) continue;
      const angle = normalizeAngle(radians * DEG);
      const along = num(node, "offset_along_line", 0) * UM;
      const across = (0 - num(node, "line_offset", 0)) * UM;
      const moved = elements.map(element => moveElement(element, along, across));
      if (!pattern) pattern = { elements: moved, dx, dy: spacing, angle };
      else if (pattern.dx === dx && pattern.dy === spacing && pattern.angle === angle) pattern.elements.push(...moved);
    }
  }
  return { fill: color(area, "inner_color") ?? undefined, hatches, pattern, border: undefined };
}

function textSymbol(node: XmlNode | undefined): Pick<TextSymbol, "color" | "size" | "fontFamily" | "bold" | "italic"> {
  const font = child(node, "font");
  return {
    color: color(child(node, "text"), "color") ?? 0,
    size: num(font, "size", 4000) * UM,
    fontFamily: attr(font, "family") ?? "Arial",
    bold: bool(font, "bold"),
    italic: bool(font, "italic")
  };
}

/** Punktsymbolens mittcirkel, ring och element, relativt mittpunkten (mm, y uppåt). */
function pointElements(point: XmlNode | undefined, center = { x: 0, y: 0 }, depth = 0): PointElement[] {
  if (!point || depth > 4) return [];
  const elements: PointElement[] = [];
  const radius = num(point, "inner_radius", 0) * UM;
  const inner = color(point, "inner_color");
  const outerWidth = num(point, "outer_width", 0) * UM;
  const outer = color(point, "outer_color");
  if (inner !== null && radius > 0) elements.push({ kind: "dot", color: inner, center, diameter: 2 * radius });
  if (outer !== null && outerWidth > 0) {
    elements.push({ kind: "circle", color: outer, center, diameter: 2 * radius + outerWidth, lineWidth: outerWidth });
  }
  for (const element of asArray(point.element)) {
    const symbol = child(element, "symbol");
    const object = child(element, "object");
    const coords = text(object?.coords);
    const triples = parseCoordText(coords, 0, coords.length) ?? [];
    const type = attr(symbol, "type");
    if (type === "1") {
      if (triples.length < 3) continue;
      const at = { x: center.x + triples[0]! * UM, y: center.y - triples[1]! * UM };
      elements.push(...pointElements(child(symbol, "point_symbol"), at, depth + 1));
      continue;
    }
    const parts = coordsToParts(triples).map(part => part.map(command => moveCommand(command, center.x, center.y)));
    if (parts.length === 0) continue;
    if (type === "2") {
      const line = child(symbol, "line_symbol");
      const lineColor = color(line, "color");
      const width = num(line, "line_width", 0) * UM;
      if (lineColor !== null && width > 0) elements.push({ kind: "line", color: lineColor, width, path: parts.flat() });
    } else if (type === "4") {
      const fill = color(child(symbol, "area_symbol"), "inner_color");
      if (fill !== null) elements.push({ kind: "area", color: fill, rings: parts });
    }
  }
  return elements;
}

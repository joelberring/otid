import type { MapObject, MapSymbol, ParsedMap, Path, PointElement } from "./model";

/**
 * BL-profilerna (ADR-0183 beslut 7): vad varje kartfärg används till, som underlag när kartans färger matchas mot ett
 * tryckeris färgtabell. Per färg: hur många objekt som använder den, som vad (yta, linje, punkt, text), vilka symbolnummer
 * (ISOM/ISSprOM) och var den syns tätast (mitten av den ruta på 40 mm som har flest objekt), så att förhandsvisningen kan
 * visa en bit av kartan där färgen finns. Dolda symboler räknas inte (de ritas inte).
 */
export type ColorUseKind = "AREA" | "LINE" | "POINT" | "TEXT";

export interface ColorUsage {
  readonly objects: number;
  readonly kinds: readonly ColorUseKind[];
  /** Symbolnumren som de står i filen ("101", "406.1"), sorterade. */
  readonly codes: readonly string[];
  /** Huvudnumren (101, 406 …), sorterade. */
  readonly mains: readonly number[];
  /** Där färgen syns tätast, i kartans mm. */
  readonly sample?: { readonly x: number; readonly y: number } | undefined;
}

/** Rutan (mm i kartan) som provstället räknas i. */
const SAMPLE_CELL_MM = 40;
/** Högst så många symbolnummer per färg (resten utelämnas). */
const MAX_CODES = 40;

function elementsUse(add: (color: number, kind: ColorUseKind) => void, elements: readonly PointElement[], kind: ColorUseKind): void {
  for (const element of elements) add(element.color, kind);
}

/** Färgerna en symbol använder och som vad. */
function symbolColors(symbol: MapSymbol, symbols: ParsedMap["symbols"], depth = 0): Map<number, Set<ColorUseKind>> {
  const out = new Map<number, Set<ColorUseKind>>();
  const add = (color: number, kind: ColorUseKind) => { const kinds = out.get(color) ?? new Set<ColorUseKind>(); kinds.add(kind); out.set(color, kinds); };
  switch (symbol.kind) {
    case "POINT": elementsUse(add, symbol.elements, "POINT"); break;
    case "LINE":
      for (const stroke of symbol.strokes) add(stroke.color, "LINE");
      for (const part of [symbol.repeated, symbol.between, symbol.corner, symbol.start, symbol.end]) if (part) elementsUse(add, part.elements, "LINE");
      break;
    case "AREA":
      if (symbol.fill !== undefined) add(symbol.fill, "AREA");
      for (const hatch of symbol.hatches) add(hatch.color, "AREA");
      if (symbol.pattern) elementsUse(add, symbol.pattern.elements, "AREA");
      for (const border of symbol.border ?? []) add(border.color, "LINE");
      break;
    case "TEXT": add(symbol.color, "TEXT"); break;
    case "COMBINED":
      if (depth > 8) break;
      for (const id of symbol.parts) {
        const part = symbols.get(id);
        if (!part || part.hidden) continue;
        for (const [color, kinds] of symbolColors(part, symbols, depth + 1)) for (const kind of kinds) add(color, kind);
      }
      break;
  }
  return out;
}

function pathCenter(paths: readonly Path[]): { x: number; y: number } | undefined {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of paths) for (const command of path) {
    minX = Math.min(minX, command.x); maxX = Math.max(maxX, command.x); minY = Math.min(minY, command.y); maxY = Math.max(maxY, command.y);
  }
  return Number.isFinite(minX) ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : undefined;
}

function objectCenter(object: MapObject): { x: number; y: number } | undefined {
  if (object.kind === "point" || object.kind === "text") return object.at;
  return pathCenter(object.kind === "line" ? [object.path] : object.rings.slice(0, 1));
}

/** Användningen per färgens id; färger som inget synligt objekt använder saknas. */
export function colorUsage(map: Pick<ParsedMap, "symbols" | "objects">): Map<number, ColorUsage> {
  const bySymbol = new Map<string, Map<number, Set<ColorUseKind>>>();
  const collected = new Map<number, { objects: number; kinds: Set<ColorUseKind>; codes: Set<string>; mains: Set<number>; cells: Map<string, number> }>();
  for (const object of map.objects) {
    const symbol = map.symbols.get(object.symbol);
    if (!symbol || symbol.hidden) continue;
    let colors = bySymbol.get(symbol.id);
    if (!colors) { colors = symbolColors(symbol, map.symbols); bySymbol.set(symbol.id, colors); }
    const center = objectCenter(object);
    const cell = center ? `${Math.floor(center.x / SAMPLE_CELL_MM)},${Math.floor(center.y / SAMPLE_CELL_MM)}` : undefined;
    for (const [color, kinds] of colors) {
      const entry = collected.get(color) ?? { objects: 0, kinds: new Set<ColorUseKind>(), codes: new Set<string>(), mains: new Set<number>(), cells: new Map<string, number>() };
      entry.objects += 1;
      for (const kind of kinds) entry.kinds.add(kind);
      entry.codes.add(symbol.code.text);
      entry.mains.add(symbol.code.main);
      if (cell) entry.cells.set(cell, (entry.cells.get(cell) ?? 0) + 1);
      collected.set(color, entry);
    }
  }
  const out = new Map<number, ColorUsage>();
  for (const [color, entry] of collected) {
    let best: [string, number] | undefined;
    for (const item of entry.cells) if (!best || item[1] > best[1]) best = item;
    const sample = best ? (() => { const [x, y] = best[0].split(",").map(Number); return { x: (x! + 0.5) * SAMPLE_CELL_MM, y: (y! + 0.5) * SAMPLE_CELL_MM }; })() : undefined;
    const order: ColorUseKind[] = ["AREA", "LINE", "POINT", "TEXT"];
    out.set(color, {
      objects: entry.objects,
      kinds: order.filter(kind => entry.kinds.has(kind)),
      codes: [...entry.codes].sort((a, b) => a.localeCompare(b, "sv-SE", { numeric: true })).slice(0, MAX_CODES),
      mains: [...entry.mains].sort((a, b) => a - b),
      ...(sample ? { sample } : {})
    });
  }
  return out;
}

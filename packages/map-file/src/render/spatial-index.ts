/**
 * ADR-0218: rumsligt index över kartans objekt, så att en vy bara planerar och ritar objekten som syns. Ett jämnt rutnät
 * (ren TypeScript, inga beroenden): varje objekt läggs i rutorna som dess ruta täcker; objekt som täcker många rutor (långa
 * höjdkurvor, stora ytor) ligger i en egen lista som prövas en och en. Frågan ger objektens nummer i kartans ordning, så att
 * ritordningen inom en färg blir densamma som utan index.
 */
import type { MapObject, MapSymbol, ParsedMap, Path, PointElement, StrokeStyle } from "../model";

export interface Box { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

/** Objekt som täcker fler rutor än så läggs i listan för stora objekt. */
const LARGE_CELLS = 64;
/** Ungefär så många objekt per ruta. */
const ITEMS_PER_CELL = 8;
const MAX_CELLS_PER_SIDE = 1024;

export class SpatialIndex {
  private readonly stamp: Uint32Array;
  private query_ = 0;

  private constructor(
    /** minX, minY, maxX, maxY per objekt (NaN = saknar ruta, kommer aldrig med). */
    private readonly boxes: Float64Array,
    private readonly origin: { readonly x: number; readonly y: number },
    private readonly cell: number,
    private readonly columns: number,
    private readonly rows: number,
    private readonly cellStart: Int32Array,
    private readonly cellItems: Int32Array,
    private readonly large: Int32Array
  ) {
    this.stamp = new Uint32Array(boxes.length / 4);
  }

  get size(): number { return this.boxes.length / 4; }

  /** Indexet över rutorna (fyra tal per objekt: minX, minY, maxX, maxY; NaN för objekt utan ruta). */
  static build(boxes: Float64Array): SpatialIndex {
    const count = boxes.length / 4;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const x0 = boxes[4 * i]!, y0 = boxes[4 * i + 1]!, x1 = boxes[4 * i + 2]!, y1 = boxes[4 * i + 3]!;
      if (!(x0 <= x1 && y0 <= y1)) continue;
      if (x0 < minX) minX = x0; if (y0 < minY) minY = y0; if (x1 > maxX) maxX = x1; if (y1 > maxY) maxY = y1;
    }
    if (!Number.isFinite(minX)) return new SpatialIndex(boxes, { x: 0, y: 0 }, 1, 1, 1, new Int32Array(2), new Int32Array(0), new Int32Array(0));
    const width = Math.max(maxX - minX, 1e-6), height = Math.max(maxY - minY, 1e-6);
    // Rutans sida så att rutnätet får ungefär count / ITEMS_PER_CELL rutor.
    const cells = Math.max(1, count / ITEMS_PER_CELL);
    let cell = Math.sqrt((width * height) / cells);
    cell = Math.max(cell, width / MAX_CELLS_PER_SIDE, height / MAX_CELLS_PER_SIDE, 1e-6);
    const columns = Math.min(MAX_CELLS_PER_SIDE, Math.max(1, Math.ceil(width / cell)));
    const rows = Math.min(MAX_CELLS_PER_SIDE, Math.max(1, Math.ceil(height / cell)));
    const col = (x: number) => Math.min(columns - 1, Math.max(0, Math.floor((x - minX) / cell)));
    const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / cell)));
    // Två varv: räkna per ruta, fyll sedan (kompakt lagring utan en lista per ruta).
    const counts = new Int32Array(columns * rows + 1);
    const large: number[] = [];
    const spans = new Int32Array(4 * count);
    for (let i = 0; i < count; i += 1) {
      const x0 = boxes[4 * i]!, y0 = boxes[4 * i + 1]!, x1 = boxes[4 * i + 2]!, y1 = boxes[4 * i + 3]!;
      if (!(x0 <= x1 && y0 <= y1)) { spans[4 * i] = -1; continue; }
      const c0 = col(x0), c1 = col(x1), r0 = row(y0), r1 = row(y1);
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > LARGE_CELLS) { large.push(i); spans[4 * i] = -1; continue; }
      spans[4 * i] = c0; spans[4 * i + 1] = r0; spans[4 * i + 2] = c1; spans[4 * i + 3] = r1;
      for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) counts[r * columns + c + 1]! += 1;
    }
    for (let k = 1; k < counts.length; k += 1) counts[k]! += counts[k - 1]!;
    const cellItems = new Int32Array(counts[counts.length - 1]!);
    const fill = counts.slice(0, -1);
    for (let i = 0; i < count; i += 1) {
      if (spans[4 * i]! < 0) continue;
      for (let r = spans[4 * i + 1]!; r <= spans[4 * i + 3]!; r += 1) {
        for (let c = spans[4 * i]!; c <= spans[4 * i + 2]!; c += 1) cellItems[fill[r * columns + c]!++] = i;
      }
    }
    return new SpatialIndex(boxes, { x: minX, y: minY }, cell, columns, rows, counts, cellItems, Int32Array.from(large));
  }

  /** Objekten vars ruta skär `box`, i stigande ordning. */
  query(box: Box): Int32Array {
    this.query_ = (this.query_ + 1) >>> 0;
    if (this.query_ === 0) { this.stamp.fill(0); this.query_ = 1; }
    const mark = this.query_;
    const out: number[] = [];
    const hit = (i: number) => {
      if (this.stamp[i] === mark) return;
      this.stamp[i] = mark;
      const b = this.boxes;
      if (b[4 * i]! <= box.maxX && b[4 * i + 2]! >= box.minX && b[4 * i + 1]! <= box.maxY && b[4 * i + 3]! >= box.minY) out.push(i);
    };
    for (const i of this.large) hit(i);
    const c0 = Math.floor((box.minX - this.origin.x) / this.cell), c1 = Math.floor((box.maxX - this.origin.x) / this.cell);
    const r0 = Math.floor((box.minY - this.origin.y) / this.cell), r1 = Math.floor((box.maxY - this.origin.y) / this.cell);
    for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r += 1) {
      for (let c = Math.max(0, c0); c <= Math.min(this.columns - 1, c1); c += 1) {
        const at = r * this.columns + c;
        for (let k = this.cellStart[at]!; k < this.cellStart[at + 1]!; k += 1) hit(this.cellItems[k]!);
      }
    }
    return Int32Array.from(out).sort();
  }
}

/** Hur långt från sin mittpunkt en punktsymbols delar når (mm), oavsett vridning. */
function elementsReach(elements: readonly PointElement[] | undefined): number {
  let reach = 0;
  for (const element of elements ?? []) {
    if (element.kind === "circle" || element.kind === "dot") reach = Math.max(reach, Math.hypot(element.center.x, element.center.y) + element.diameter / 2);
    else if (element.kind === "line") reach = Math.max(reach, pathReach([element.path]) + element.width / 2);
    else reach = Math.max(reach, pathReach(element.rings));
  }
  return reach;
}

function pathReach(paths: readonly Path[]): number {
  let reach = 0;
  for (const path of paths) for (const command of path) {
    reach = Math.max(reach, Math.hypot(command.x, command.y));
    if (command.type === "C") reach = Math.max(reach, Math.hypot(command.x1, command.y1), Math.hypot(command.x2, command.y2));
  }
  return reach;
}

const strokesReach = (strokes: readonly StrokeStyle[] | undefined) =>
  (strokes ?? []).reduce((reach, stroke) => Math.max(reach, stroke.width / 2 + Math.abs(stroke.offset ?? 0)), 0);

/** Hörnsymbolen kan sträckas upp till tre gånger i spetsiga hörn (`along.ts`). */
const CORNER_STRETCH = 3;

/** Hur långt utanför objektets geometri symbolen kan rita (mm). Texten räknas per objekt. */
function symbolReach(symbols: ParsedMap["symbols"], id: string, depth = 0): number {
  const symbol: MapSymbol | undefined = symbols.get(id);
  if (!symbol || depth > 8) return 0;
  switch (symbol.kind) {
    case "POINT": return elementsReach(symbol.elements);
    case "LINE": return Math.max(strokesReach(symbol.strokes), elementsReach(symbol.repeated?.elements), elementsReach(symbol.between?.elements),
      elementsReach(symbol.corner?.elements) * CORNER_STRETCH, elementsReach(symbol.start?.elements), elementsReach(symbol.end?.elements));
    case "AREA": return strokesReach(symbol.border);
    case "TEXT": return 0;
    case "COMBINED": return symbol.parts.reduce((reach, part) => Math.max(reach, symbolReach(symbols, part, depth + 1)), 0);
  }
}

/** Textens största utbredning från ankarpunkten (mm): en fyrkant per tecken och radavståndet, i alla riktningar. */
function textReach(map: ParsedMap, object: Extract<MapObject, { kind: "text" }>): number {
  let size = 0;
  const visit = (id: string, depth: number) => {
    const symbol = map.symbols.get(id);
    if (!symbol || depth > 8) return;
    if (symbol.kind === "TEXT") size = Math.max(size, symbol.size);
    else if (symbol.kind === "COMBINED") for (const part of symbol.parts) visit(part, depth + 1);
  };
  visit(object.symbol, 0);
  const lines = object.text.split(/\r?\n/);
  const longest = lines.reduce((most, line) => Math.max(most, line.length), 0);
  return Math.hypot(longest * size, (lines.length + 1) * size * 1.15);
}

/** Varje objekts ruta (mm) med det symbolen ritar utanför geometrin: fyra tal per objekt i kartans ordning. */
export function objectBoxes(map: ParsedMap): Float64Array {
  const reach = new Map<string, number>();
  const boxes = new Float64Array(map.objects.length * 4);
  map.objects.forEach((object, index) => {
    let pad = reach.get(object.symbol);
    if (pad === undefined) { pad = symbolReach(map.symbols, object.symbol); reach.set(object.symbol, pad); }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x: number, y: number) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
    const addPaths = (paths: readonly Path[]) => {
      for (const path of paths) for (const command of path) {
        add(command.x, command.y);
        if (command.type === "C") { add(command.x1, command.y1); add(command.x2, command.y2); }
      }
    };
    if (object.kind === "point") add(object.at.x, object.at.y);
    else if (object.kind === "text") { add(object.at.x, object.at.y); pad += textReach(map, object); }
    else if (object.kind === "line") addPaths([object.path]);
    else addPaths(object.rings);
    if (!Number.isFinite(minX)) { boxes.fill(Number.NaN, 4 * index, 4 * index + 4); return; }
    boxes[4 * index] = minX - pad; boxes[4 * index + 1] = minY - pad; boxes[4 * index + 2] = maxX + pad; boxes[4 * index + 3] = maxY + pad;
  });
  return boxes;
}

const indexes = new WeakMap<ParsedMap, SpatialIndex>();

/** Kartans index, byggt första gången det behövs och sparat så länge kartan finns kvar. */
export function spatialIndexOf(map: ParsedMap): SpatialIndex {
  let index = indexes.get(map);
  if (!index) { index = SpatialIndex.build(objectBoxes(map)); indexes.set(map, index); }
  return index;
}

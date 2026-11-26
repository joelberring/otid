/**
 * Kartans hinder för kontrollnumren (ADR-0211 beslut 4): byggnader (ISOM 521, 526 och liknande), andra mörka eller svarta
 * ytor och svarta linjer nära varje kontroll. Ren funktion över kartfilen, räknad där kartan finns (editorns och
 * förhandsvisningens Worker, utskriftsarbetaren) och given till `layoutOverprint` som `numberObstacles`, så att den
 * automatiska placeringen undviker dem när det finns plats. Ett nummer som banläggaren placerat flyttas aldrig; det får en
 * notis i Varningar om det ligger på ett hinder (`numberObstacleNotices`).
 */
import { flattenPath, type MapColor, type ParsedMap, type Point } from "@o-tid/map-file";

export interface NumberObstacles {
  /** Mörka ytor (byggnader och liknande) som ringar i kartans mm. */
  readonly areas: readonly (readonly Point[])[];
  /** Svarta linjer som sträckor i kartans mm. */
  readonly lines: readonly (readonly [Point, Point])[];
}

/** Hur långt från kontrollen hindren samlas (kartans mm): ringen, avståndet och ett tresiffrigt nummer i 1:10 000 med marginal. */
export const NUMBER_OBSTACLE_REACH_MM = 20;

/** Byggnader och liknande (ISOM 2017-2 / ISSprOM 2019-2): byggnad, ruin, stort föremål; deras yta är ett hinder i alla färger. */
const BUILDING_MAINS = [521, 522, 526];

const luminance = (color: MapColor | undefined) => color ? 0.2126 * color.rgb.r + 0.7152 * color.rgb.g + 0.0722 * color.rgb.b : 1;
/** Mörk yta: så mörk att lila siffror inte läses på den (svart, mörkgrått, mörk olivgrön). */
const darkFill = (color: MapColor | undefined) => color !== undefined && color.opacity > 0.5 && luminance(color) < 0.45;
const blackLine = (color: MapColor | undefined) => color !== undefined && color.opacity > 0.5 && luminance(color) < 0.2;

export interface ObstaclePoint { readonly id: string; readonly at: Point }

/** Objekt som täcker fler rutor än så ligger i en egen lista (samma mönster som kartans SpatialIndex). */
const LARGE_CELLS = 64;
const ITEMS_PER_CELL = 16;
const MAX_CELLS_PER_SIDE = 512;

/** Jämnt rutnät över axelparallella rutor med stamp-deduplicering och bevarad stigande indexordning. */
class BoxGrid {
  private readonly stamp: Uint32Array;
  private queryId = 0;

  private constructor(
    private readonly boxes: Float64Array,
    private readonly minX: number,
    private readonly minY: number,
    private readonly maxX: number,
    private readonly maxY: number,
    private readonly cell: number,
    private readonly columns: number,
    private readonly rows: number,
    private readonly cellStart: Int32Array,
    private readonly cellItems: Int32Array,
    private readonly large: Int32Array
  ) {
    this.stamp = new Uint32Array(boxes.length / 4);
  }

  static build(boxes: Float64Array): BoxGrid {
    const count = boxes.length / 4;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const x0 = boxes[4 * i]!, y0 = boxes[4 * i + 1]!, x1 = boxes[4 * i + 2]!, y1 = boxes[4 * i + 3]!;
      if (!(Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1) && x0 <= x1 && y0 <= y1)) continue;
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x1 > maxX) maxX = x1;
      if (y1 > maxY) maxY = y1;
    }
    if (!Number.isFinite(minX)) {
      const large: number[] = [];
      for (let i = 0; i < count; i += 1) {
        const x0 = boxes[4 * i]!, y0 = boxes[4 * i + 1]!, x1 = boxes[4 * i + 2]!, y1 = boxes[4 * i + 3]!;
        if (x0 <= x1 && y0 <= y1) large.push(i);
      }
      return new BoxGrid(boxes, 0, 0, -1, -1, 1, 1, 1, new Int32Array(2), new Int32Array(0), Int32Array.from(large));
    }
    const width = Math.max(maxX - minX, 1e-6), height = Math.max(maxY - minY, 1e-6);
    const targetCells = Math.max(1, count / ITEMS_PER_CELL);
    let cell = Math.sqrt((width * height) / targetCells);
    cell = Math.max(cell, width / MAX_CELLS_PER_SIDE, height / MAX_CELLS_PER_SIDE, 1e-6);
    const columns = Math.min(MAX_CELLS_PER_SIDE, Math.max(1, Math.ceil(width / cell)));
    const rows = Math.min(MAX_CELLS_PER_SIDE, Math.max(1, Math.ceil(height / cell)));
    const col = (x: number) => Math.min(columns - 1, Math.max(0, Math.floor((x - minX) / cell)));
    const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / cell)));
    const counts = new Int32Array(columns * rows + 1);
    const large: number[] = [];
    const spans = new Int32Array(4 * count);
    for (let i = 0; i < count; i += 1) {
      const x0 = boxes[4 * i]!, y0 = boxes[4 * i + 1]!, x1 = boxes[4 * i + 2]!, y1 = boxes[4 * i + 3]!;
      if (!(x0 <= x1 && y0 <= y1)) { spans[4 * i] = -1; continue; }
      if (!(Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1))) {
        large.push(i); spans[4 * i] = -1; continue;
      }
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
      const c0 = spans[4 * i]!, r0 = spans[4 * i + 1]!, c1 = spans[4 * i + 2]!, r1 = spans[4 * i + 3]!;
      for (let r = r0; r <= r1; r += 1) {
        for (let c = c0; c <= c1; c += 1) cellItems[fill[r * columns + c]!++] = i;
      }
    }
    return new BoxGrid(boxes, minX, minY, maxX, maxY, cell, columns, rows, counts, cellItems, Int32Array.from(large));
  }

  /** Index för alla rutor som skär frågerutan, i exakt stigande ordning. */
  query(qMinX: number, qMinY: number, qMaxX: number, qMaxY: number): number[] {
    const count = this.boxes.length / 4;
    if (count === 0) return [];
    const b = this.boxes;
    if (!(qMinX <= qMaxX && qMinY <= qMaxY)) {
      const out: number[] = [];
      for (let i = 0; i < count; i += 1) {
        if (b[4 * i + 2]! >= qMinX && b[4 * i]! <= qMaxX && b[4 * i + 3]! >= qMinY && b[4 * i + 1]! <= qMaxY) out.push(i);
      }
      return out;
    }
    this.queryId = (this.queryId + 1) >>> 0;
    if (this.queryId === 0) { this.stamp.fill(0); this.queryId = 1; }
    const mark = this.queryId;
    const out: number[] = [];
    for (let k = 0; k < this.large.length; k += 1) {
      const i = this.large[k]!;
      this.stamp[i] = mark;
      if (b[4 * i + 2]! >= qMinX && b[4 * i]! <= qMaxX && b[4 * i + 3]! >= qMinY && b[4 * i + 1]! <= qMaxY) out.push(i);
    }
    if (this.minX <= this.maxX && qMaxX >= this.minX && qMinX <= this.maxX && qMaxY >= this.minY && qMinY <= this.maxY) {
      const c0 = Math.min(this.columns - 1, Math.max(0, Math.floor((qMinX - this.minX) / this.cell)));
      const c1 = Math.min(this.columns - 1, Math.max(0, Math.floor((qMaxX - this.minX) / this.cell)));
      const r0 = Math.min(this.rows - 1, Math.max(0, Math.floor((qMinY - this.minY) / this.cell)));
      const r1 = Math.min(this.rows - 1, Math.max(0, Math.floor((qMaxY - this.minY) / this.cell)));
      for (let r = r0; r <= r1; r += 1) {
        const rowOffset = r * this.columns;
        for (let c = c0; c <= c1; c += 1) {
          const at = rowOffset + c;
          const start = this.cellStart[at]!, end = this.cellStart[at + 1]!;
          for (let k = start; k < end; k += 1) {
            const i = this.cellItems[k]!;
            if (this.stamp[i] === mark) continue;
            this.stamp[i] = mark;
            if (b[4 * i + 2]! >= qMinX && b[4 * i]! <= qMaxX && b[4 * i + 3]! >= qMinY && b[4 * i + 1]! <= qMaxY) out.push(i);
          }
        }
      }
    }
    if (out.length > 1) out.sort((a, bIdx) => a - bIdx);
    return out;
  }
}

interface PreparedObstacles {
  readonly areas: readonly Point[][];
  readonly areaGrid: BoxGrid;
  readonly lines: readonly [Point, Point][];
  readonly lineGrid: BoxGrid;
}

/** Kartans hinder läses och indexeras en gång per karta (editorn frågar efter varje flyttad kontroll). */
const prepared = new WeakMap<ParsedMap, PreparedObstacles>();
/** Ringens omslutande ruta för snabb avvisning i `areaCover`. */
const ringBoxes = new WeakMap<readonly Point[], readonly [number, number, number, number]>();

function computeRingBox(points: readonly Point[]): readonly [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    if (Number.isNaN(p.x) || Number.isNaN(p.y)) return [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return [minX, minY, maxX, maxY];
}

function ringBoxOf(ring: readonly Point[]): readonly [number, number, number, number] {
  let box = ringBoxes.get(ring);
  if (!box) {
    box = computeRingBox(ring);
    ringBoxes.set(ring, box);
  }
  return box;
}

export function computeNumberObstacles(map: ParsedMap, controls: readonly ObstaclePoint[], reachMm = NUMBER_OBSTACLE_REACH_MM): Record<string, NumberObstacles> {
  const { areas, areaGrid, lines, lineGrid } = prepared.get(map) ?? prepareObstacles(map);
  const out: Record<string, NumberObstacles> = {};
  for (const control of controls) {
    const qMinX = control.at.x - reachMm, qMaxX = control.at.x + reachMm;
    const qMinY = control.at.y - reachMm, qMaxY = control.at.y + reachMm;
    const areaIdx = areaGrid.query(qMinX, qMinY, qMaxX, qMaxY);
    const lineIdx = lineGrid.query(qMinX, qMinY, qMaxX, qMaxY);
    if (areaIdx.length === 0 && lineIdx.length === 0) continue;
    const a = new Array<Point[]>(areaIdx.length);
    for (let k = 0; k < areaIdx.length; k += 1) a[k] = areas[areaIdx[k]!]!;
    const l = new Array<[Point, Point]>(lineIdx.length);
    for (let k = 0; k < lineIdx.length; k += 1) l[k] = lines[lineIdx[k]!]!;
    out[control.id] = { areas: a, lines: l };
  }
  return out;
}

function prepareObstacles(map: ParsedMap): PreparedObstacles {
  const colors = new Map(map.colors.map(color => [color.id, color]));
  const areas: Point[][] = [];
  const areaCoords: number[] = [];
  const lines: [Point, Point][] = [];
  const lineCoords: number[] = [];
  for (const object of map.objects) {
    const symbol = map.symbols.get(object.symbol);
    if (!symbol || symbol.hidden) continue;
    if (object.kind === "area" && symbol.kind === "AREA") {
      const building = BUILDING_MAINS.includes(symbol.code.main);
      if (!building && !darkFill(colors.get(symbol.fill ?? -1))) continue;
      const ring = flattenPath(object.rings[0]!).flat();
      if (ring.length >= 3) {
        const box = computeRingBox(ring);
        ringBoxes.set(ring, box);
        areas.push(ring);
        areaCoords.push(box[0], box[1], box[2], box[3]);
      }
    } else if (object.kind === "line" && symbol.kind === "LINE") {
      if (!symbol.strokes.some(stroke => blackLine(colors.get(stroke.color)) && stroke.width >= 0.1)) continue;
      for (const part of flattenPath(object.path)) {
        for (let i = 1; i < part.length; i++) {
          const p = part[i - 1]!, q = part[i]!;
          lines.push([p, q]);
          lineCoords.push(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.max(p.x, q.x), Math.max(p.y, q.y));
        }
      }
    }
  }
  const result: PreparedObstacles = {
    areas,
    areaGrid: BoxGrid.build(Float64Array.from(areaCoords)),
    lines,
    lineGrid: BoxGrid.build(Float64Array.from(lineCoords))
  };
  prepared.set(map, result);
  return result;
}

interface Box { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number }

function pointInRing(px: number, py: number, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > py) !== (b.y > py) && px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Andelen (0–1) av rutan som täcks av mörka ytor, provad i ett rutnät 5 × 3. */
export function areaCover(box: Box, obstacles: NumberObstacles | undefined): number {
  if (!obstacles || obstacles.areas.length === 0) return 0;
  const x0 = box.cx - box.w / 2, x1 = box.cx + box.w / 2;
  const y0 = box.cy - box.h / 2, y1 = box.cy + box.h / 2;
  const minX = x0 <= x1 ? x0 : x1, maxX = x0 <= x1 ? x1 : x0;
  const minY = y0 <= y1 ? y0 : y1, maxY = y0 <= y1 ? y1 : y0;
  const active: (readonly Point[])[] = [];
  for (let k = 0; k < obstacles.areas.length; k += 1) {
    const ring = obstacles.areas[k]!;
    const [rMinX, rMinY, rMaxX, rMaxY] = ringBoxOf(ring);
    if (rMaxX < minX || rMinX > maxX || rMaxY < minY || rMinY > maxY) continue;
    active.push(ring);
  }
  if (active.length === 0) return 0;
  let hit = 0;
  for (let i = 0; i < 5; i++) {
    const px = x0 + box.w * (i + 0.5) / 5;
    for (let j = 0; j < 3; j++) {
      const py = y0 + box.h * (j + 0.5) / 3;
      for (let k = 0; k < active.length; k += 1) {
        if (pointInRing(px, py, active[k]!)) { hit++; break; }
      }
    }
  }
  return hit / 15;
}

function segmentHitsBox(a: Point, b: Point, minX: number, maxX: number, minY: number, maxY: number): boolean {
  if ((a.x < minX && b.x < minX) || (a.x > maxX && b.x > maxX) || (a.y < minY && b.y < minY) || (a.y > maxY && b.y > maxY)) return false;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x;
  if (dx === 0) {
    if (a.x < minX || a.x > maxX) return false;
  } else {
    const r0 = (a.x - minX) / -dx;
    const r1 = (maxX - a.x) / dx;
    if (dx > 0) {
      if (r0 > t1) return false;
      if (r0 > t0) t0 = r0;
      if (r1 < t0) return false;
      if (r1 < t1) t1 = r1;
    } else {
      if (r0 < t0) return false;
      if (r0 < t1) t1 = r0;
      if (r1 > t1) return false;
      if (r1 > t0) t0 = r1;
    }
  }
  const dy = b.y - a.y;
  if (dy === 0) {
    if (a.y < minY || a.y > maxY) return false;
  } else {
    const r2 = (a.y - minY) / -dy;
    const r3 = (maxY - a.y) / dy;
    if (dy > 0) {
      if (r2 > t1) return false;
      if (r2 > t0) t0 = r2;
      if (r3 < t0) return false;
      if (r3 < t1) t1 = r3;
    } else {
      if (r2 < t0) return false;
      if (r2 < t1) t1 = r2;
      if (r3 > t1) return false;
      if (r3 > t0) t0 = r3;
    }
  }
  return true;
}

/** Antalet svarta linjer som går genom rutan. */
export function linesCrossing(box: Box, obstacles: NumberObstacles | undefined): number {
  if (!obstacles || obstacles.lines.length === 0) return 0;
  const minX = box.cx - box.w / 2, maxX = box.cx + box.w / 2, minY = box.cy - box.h / 2, maxY = box.cy + box.h / 2;
  let count = 0;
  for (let i = 0; i < obstacles.lines.length; i += 1) {
    const [a, b] = obstacles.lines[i]!;
    if (segmentHitsBox(a, b, minX, maxX, minY, maxY)) count++;
  }
  return count;
}

/** Kostnaderna i placeringen (samma skala som linjer och ringar, 10 per krock): en hel ruta på ett hus kostar 8. */
export const NUMBER_OBSTACLE_COST = { area: 8, line: 3 } as const;

export function obstacleCost(box: Box, obstacles: NumberObstacles | undefined): number {
  return NUMBER_OBSTACLE_COST.area * areaCover(box, obstacles) + NUMBER_OBSTACLE_COST.line * linesCrossing(box, obstacles);
}

import { flattenPath, type MapObject, type Point } from "@o-tid/map-file";
import type { ObjectKey } from "./state";

/**
 * Normkontrollen (ägaren 2026-11-08): kartans objekt mot ISOM 2017-2:s grafiska minimimått (avsnitt 2.11.3 och symbolernas
 * parametrar). Måtten gäller grundskalan 1:15 000 och blir 1,5 gånger större på en förstorad karta (1:10 000). För sprintkartor
 * (ISSprOM 2019-2) gäller här bara de allmänna avstånden; symbolernas egna mått kommer senare. Kontrollen säger var något bör
 * ses över; den ändrar inget.
 */
export type NormRule = "CONTOUR_GAP" | "SHORT_LINE" | "SMALL_AREA" | "THIN_AREA" | "SMALL_CLOSED";
export const NORM_RULES: readonly NormRule[] = ["CONTOUR_GAP", "SHORT_LINE", "SMALL_AREA", "THIN_AREA", "SMALL_CLOSED"];
export interface NormObject { readonly key: ObjectKey; readonly code: string; readonly object: MapObject; readonly lineWidth?: number | undefined }
export interface NormIssue {
  readonly rule: NormRule; readonly key: ObjectKey; readonly code: string; readonly at: Point;
  /** Det uppmätta och gränsen, i kartans mm (yta i mm²). */
  readonly value: number; readonly limit: number;
  /** Det andra objektet (kurvavståndet). */
  readonly other?: ObjectKey | undefined;
}
export interface NormResult {
  readonly standard: "ISOM" | "ISSPROM";
  /** Hur mycket större måtten är än i grundskalan (1,5 för 1:10 000). */
  readonly factor: number;
  readonly issues: readonly NormIssue[];
  /** Fler fel än som visas. */
  readonly truncated: boolean;
}

/** Allmänt minsta mellanrum mellan två symbolers konturer (mm i grundskalan). */
export const MIN_GAP_MM = 0.15;
const CONTOURS = new Set([101, 102, 103]);
/** Linjebredd i grundskalan när filen inte säger något. */
const CONTOUR_WIDTH: Readonly<Record<number, number>> = { 101: 0.14, 102: 0.25, 103: 0.14 };
/** Minsta längd för en fristående linje (mm i grundskalan). */
const MIN_LENGTH: Readonly<Record<number, number>> = { 104: 0.6, 201: 0.6, 202: 0.6, 304: 1, 305: 1, 306: 2.75, 504: 6.25, 505: 4.25, 506: 2.25,
  507: 5.3, 508: 3.25, 509: 4, 510: 5, 513: 1.4, 515: 3, 516: 1.5, 518: 2, 529: 2 };
/** Minsta yta (mm² i grundskalan; för de flesta a × b i normen). */
const MIN_AREA: Readonly<Record<number, number>> = { 206: 0.3, 301: 0.55 * 0.55, 302: 0.55 * 0.55, 308: 0.5 * 0.4, 401: 0.55 * 0.55, 403: 1, 404: 2.5 * 2.5,
  406: 1, 408: 0.7 * 0.7, 410: 0.55 * 0.55, 412: 9, 413: 4, 501: 1, 520: 1, 521: 0.5 * 0.5 };
/** Minsta bredd för ytor (mm i grundskalan). */
const MIN_WIDTH: Readonly<Record<number, number>> = { 206: 0.25, 301: 0.3, 404: 1.5, 406: 0.4, 408: 0.3, 410: 0.25 };
/** Ett slutet kurvobjekt (kulle): minst 0,9 × 0,6 mm (101, 102); en formlinje minst 1,1 mm (103, yttermått). */
const MAX_ISSUES = 2000;

const mainOf = (code: string) => Number.parseInt(code, 10);

/** Grundskalan och faktorn: sprint upp till 1:5 000, annars ISOM (1,5 under 1:15 000). */
export function normScale(scale: number): { standard: "ISOM" | "ISSPROM"; factor: number } {
  if (scale <= 5000) return { standard: "ISSPROM", factor: 1 };
  return { standard: "ISOM", factor: scale < 15000 ? 1.5 : 1 };
}

const lengthOf = (line: readonly Point[]) => line.reduce((sum, point, index) => index === 0 ? 0
  : sum + Math.hypot(point.x - line[index - 1]!.x, point.y - line[index - 1]!.y), 0);
const ringArea = (ring: readonly Point[]) => Math.abs(ring.reduce((sum, point, index) => {
  const next = ring[(index + 1) % ring.length]!;
  return sum + point.x * next.y - next.x * point.y;
}, 0) / 2);
const ringPerimeter = (ring: readonly Point[]) => lengthOf([...ring, ring[0]!]);

/** Kortaste avståndet mellan två sträckor och punkterna där det är. */
function segmentDistance(a: Point, b: Point, c: Point, d: Point): { distance: number; at: Point } {
  const closest = (p: Point, s: Point, e: Point) => {
    const dx = e.x - s.x, dy = e.y - s.y, len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / len));
    return { x: s.x + t * dx, y: s.y + t * dy };
  };
  // Korsar de varandra är avståndet noll.
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    const t = d1 / (d1 - d2);
    return { distance: 0, at: { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) } };
  }
  let best = { distance: Infinity, at: a };
  for (const [p, s, e] of [[a, c, d], [b, c, d], [c, a, b], [d, a, b]] as const) {
    const q = closest(p, s, e);
    const distance = Math.hypot(p.x - q.x, p.y - q.y);
    if (distance < best.distance) best = { distance, at: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } };
  }
  return best;
}

interface Segment { readonly owner: number; readonly a: Point; readonly b: Point }
/** Sträckorna i ett rutnät så att bara grannar jämförs. */
class SegmentGrid {
  private readonly cells = new Map<string, Segment[]>();
  constructor(private readonly size: number) {}
  private cell(x: number, y: number) { return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`; }
  add(segment: Segment) {
    const keys = new Set<string>();
    const steps = Math.max(1, Math.ceil(Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) / this.size));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      keys.add(this.cell(segment.a.x + t * (segment.b.x - segment.a.x), segment.a.y + t * (segment.b.y - segment.a.y)));
    }
    for (const key of keys) { const list = this.cells.get(key); if (list) list.push(segment); else this.cells.set(key, [segment]); }
  }
  near(point: Point): Segment[] {
    const result: Segment[] = [];
    const cx = Math.floor(point.x / this.size), cy = Math.floor(point.y / this.size);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) result.push(...this.cells.get(`${cx + dx},${cy + dy}`) ?? []);
    return result;
  }
  entries() { return this.cells.values(); }
}

/** Kartans objekt mot normen. `scale` är kartans skala (t.ex. 10 000). */
export function checkNorm(objects: readonly NormObject[], scale: number): NormResult {
  const { standard, factor } = normScale(scale);
  const issues: NormIssue[] = [];
  const add = (issue: NormIssue) => { if (issues.length < MAX_ISSUES) issues.push(issue); };
  const lines = objects.map(item => item.object.kind === "line" ? flattenPath(item.object.path).flat() : undefined);

  // Kurvorna: minst 0,15 mm mellan konturerna (mitt till mitt: 0,15 + halva bredderna).
  const contours = objects.map((item, index) => ({ item, index, main: mainOf(item.code) }))
    .filter(row => CONTOURS.has(row.main) && row.item.object.kind === "line" && (lines[row.index]?.length ?? 0) >= 2);
  const widthOf = (row: { item: NormObject; main: number }) => row.item.lineWidth ?? CONTOUR_WIDTH[row.main]! * factor;
  const maxLimit = MIN_GAP_MM * factor + Math.max(0, ...contours.map(widthOf));
  const grid = new SegmentGrid(Math.max(maxLimit, 0.05));
  for (const row of contours) {
    const line = lines[row.index]!;
    for (let at = 1; at < line.length; at += 1) grid.add({ owner: row.index, a: line[at - 1]!, b: line[at]! });
  }
  const byIndex = new Map(contours.map(row => [row.index, row]));
  const reported = new Map<string, Point[]>();
  for (const list of grid.entries()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const s = list[i]!, t = list[j]!;
        if (s.owner === t.owner) continue;
        const first = byIndex.get(Math.min(s.owner, t.owner))!, second = byIndex.get(Math.max(s.owner, t.owner))!;
        const limit = MIN_GAP_MM * factor + (widthOf(first) + widthOf(second)) / 2;
        const { distance, at } = segmentDistance(s.a, s.b, t.a, t.b);
        if (distance >= limit) continue;
        // Ett fel per par och millimeter (i grundskalan).
        const pair = `${first.index}|${second.index}`;
        const seen = reported.get(pair) ?? [];
        if (seen.some(point => Math.hypot(point.x - at.x, point.y - at.y) < factor)) continue;
        seen.push(at); reported.set(pair, seen);
        add({ rule: "CONTOUR_GAP", key: first.item.key, other: second.item.key, code: first.item.code, at, value: distance, limit });
      }
    }
  }

  // Fristående linjer som är för korta (ändarna rör ingen annan linje med samma nummer).
  const ends = new SegmentGrid(Math.max(0.2 * factor, 0.05));
  objects.forEach((item, index) => {
    const line = lines[index];
    if (!line || MIN_LENGTH[mainOf(item.code)] === undefined) return;
    for (let at = 1; at < line.length; at += 1) ends.add({ owner: index, a: line[at - 1]!, b: line[at]! });
  });
  objects.forEach((item, index) => {
    const line = lines[index], min = MIN_LENGTH[mainOf(item.code)];
    if (!line || line.length < 2 || min === undefined) return;
    const length = lengthOf(line);
    if (length >= min * factor) return;
    const touches = (point: Point) => ends.near(point).some(segment => segment.owner !== index && mainOf(objects[segment.owner]!.code) === mainOf(item.code)
      && segmentDistance(point, point, segment.a, segment.b).distance <= 0.2 * factor);
    if (touches(line[0]!) || touches(line[line.length - 1]!)) return;
    add({ rule: "SHORT_LINE", key: item.key, code: item.code, at: line[Math.floor(line.length / 2)]!, value: length, limit: min * factor });
  });

  // Ytor: minsta yta och (ungefär) minsta bredd; slutna kurvor (kullar).
  objects.forEach((item, index) => {
    const main = mainOf(item.code);
    if (item.object.kind === "area") {
      const rings = item.object.rings.map(ring => flattenPath(ring).flat()).filter(ring => ring.length >= 3);
      const outer = rings[0];
      if (!outer) return;
      const area = Math.max(0, ringArea(outer) - rings.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0));
      const perimeter = rings.reduce((sum, ring) => sum + ringPerimeter(ring), 0);
      const center = { x: outer.reduce((sum, point) => sum + point.x, 0) / outer.length, y: outer.reduce((sum, point) => sum + point.y, 0) / outer.length };
      const minArea = MIN_AREA[main], minWidth = MIN_WIDTH[main];
      if (minArea !== undefined && area < minArea * factor * factor) {
        add({ rule: "SMALL_AREA", key: item.key, code: item.code, at: center, value: area, limit: minArea * factor * factor });
        return;
      }
      // 2·yta/omkrets är bredden för en smal remsa och halva bredden för en kompakt yta: bara tydligt smala remsor tas med.
      if (minWidth !== undefined && perimeter > 0 && 2 * area / perimeter < minWidth * factor / 2) {
        add({ rule: "THIN_AREA", key: item.key, code: item.code, at: center, value: 2 * area / perimeter, limit: minWidth * factor });
      }
      return;
    }
    const line = lines[index];
    if (!line || !(main === 101 || main === 102 || main === 103) || line.length < 3) return;
    const first = line[0]!, last = line[line.length - 1]!;
    if (Math.hypot(first.x - last.x, first.y - last.y) > 0.01) return;
    const xs = line.map(point => point.x), ys = line.map(point => point.y);
    const sides = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].sort((a, b) => b - a) as [number, number];
    const width = item.lineWidth ?? CONTOUR_WIDTH[main]! * factor;
    const center = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 };
    if (main === 103 ? sides[0] + width < 1.1 * factor : sides[0] < 0.9 * factor || sides[1] < 0.6 * factor) {
      add({ rule: "SMALL_CLOSED", key: item.key, code: item.code, at: center, value: sides[0], limit: (main === 103 ? 1.1 : 0.9) * factor });
    }
  });
  return { standard, factor, issues, truncated: issues.length >= MAX_ISSUES };
}

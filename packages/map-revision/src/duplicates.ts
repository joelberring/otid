import { flattenPath, type MapObject, type Point } from "@o-tid/map-file";
import polygonClipping, { type Polygon } from "polygon-clipping";
import { areaPolygon, multiArea, polygonArea, polygonBox, type Box } from "./area-split";
import { codeParts } from "./map-norm";

/**
 * «Ta bort dubbletter» (ägaren 2026-11-23: «mörkgröna ytor ligger trippelt i denna fil av någon anledning?»). Objekt som ligger
 * dubbelt i kartan och bara syns som ett:
 * - ytor med samma symbol som överlappar till minst 90 % av den största (den största står kvar),
 * - linjer med samma symbol där minst 90 % av var och en ligger inom 0,15 mm från den andra (den längsta står kvar),
 * - punkter med samma symbol på samma ställe (inom 0,05 mm),
 * - kapslat grönt: en ljusare grön yta (406 under 408 under 410) som till minst 90 % täcks av en enda mörkare. Grundkartans
 *   vegetation var kapslad (≥ 406, ≥ 408, ≥ 410), så en fläck 410 utan ljusare kant blev tre ytor med samma kant.
 * Ren TypeScript utan I/O, i kartans mm.
 */
export const DUPLICATE_SHARE = 0.9;
const LINE_TOLERANCE_MM = 0.15, POINT_TOLERANCE_MM = 0.05;
/** Det kapslade gröna, ljusast först. */
const NESTED_GREEN = [406, 408, 410] as const;

export interface DuplicateRow { readonly key: string; readonly code: string; readonly object: MapObject }
export interface DuplicatePlan {
  /** Nycklarna som tas bort. */
  readonly remove: readonly string[];
  /** Antal borttagna per symbolnummer. */
  readonly bySymbol: Readonly<Record<string, number>>;
}

interface Shape { readonly row: DuplicateRow; readonly box: Box; readonly size: number; readonly polygon?: Polygon; readonly points?: readonly Point[][] }

const boxOfPoints = (lines: readonly (readonly Point[])[]): Box => {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const line of lines) for (const p of line) { box.minX = Math.min(box.minX, p.x); box.minY = Math.min(box.minY, p.y); box.maxX = Math.max(box.maxX, p.x); box.maxY = Math.max(box.maxY, p.y); }
  return box;
};
const lengthOf = (lines: readonly (readonly Point[])[]) => lines.reduce((sum, line) => sum + line.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - line[i]!.x, p.y - line[i]!.y), 0), 0);
const boxOverlap = (a: Box, b: Box) => Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
const near = (a: Box, b: Box, pad: number) => a.minX <= b.maxX + pad && b.minX <= a.maxX + pad && a.minY <= b.maxY + pad && b.minY <= a.maxY + pad;

function shapeOf(row: DuplicateRow): Shape | undefined {
  const object = row.object;
  if (object.kind === "area") {
    const polygon = areaPolygon(object);
    if (polygon.length === 0) return undefined;
    return { row, polygon, box: polygonBox(polygon), size: polygonArea(polygon) };
  }
  if (object.kind === "line") {
    const points = flattenPath(object.path).filter(line => line.length >= 2);
    return points.length ? { row, points, box: boxOfPoints(points), size: lengthOf(points) } : undefined;
  }
  if (object.kind === "point") return { row, box: { minX: object.at.x, minY: object.at.y, maxX: object.at.x, maxY: object.at.y }, size: 0 };
  return undefined;
}

const intersection = (a: Polygon, b: Polygon) => { try { return multiArea(polygonClipping.intersection(a, b)); } catch { return 0; } };

/** Avståndet från en punkt till närmaste sträcka i linjerna. */
function distanceTo(point: Point, lines: readonly (readonly Point[])[]): number {
  let best = Infinity;
  for (const line of lines) for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]!, b = line[i]!, dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    const t = length2 > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
    best = Math.min(best, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return best;
}
/** Andelen av linjen (punkter var 0,2 mm) som ligger inom toleransen från de andra linjerna. */
function shareNear(lines: readonly (readonly Point[])[], other: readonly (readonly Point[])[]): number {
  let inside = 0, all = 0;
  for (const line of lines) for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]!, b = line[i]!, steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.2));
    for (let k = i === 1 ? 0 : 1; k <= steps; k += 1) {
      const t = k / steps;
      all += 1;
      if (distanceTo({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, other) <= LINE_TOLERANCE_MM) inside += 1;
    }
  }
  return all ? inside / all : 0;
}

/** Ligger `b` dubbelt med `a` (samma symbol)? */
function same(a: Shape, b: Shape): boolean {
  const object = a.row.object;
  if (object.kind === "point" && b.row.object.kind === "point") {
    return Math.hypot(object.at.x - b.row.object.at.x, object.at.y - b.row.object.at.y) <= POINT_TOLERANCE_MM;
  }
  const big = Math.max(a.size, b.size), small = Math.min(a.size, b.size);
  if (big <= 0 || small < DUPLICATE_SHARE * big) return false;
  if (a.polygon && b.polygon) return boxOverlap(a.box, b.box) >= DUPLICATE_SHARE * big && intersection(a.polygon, b.polygon) >= DUPLICATE_SHARE * big;
  if (a.points && b.points) return shareNear(a.points, b.points) >= DUPLICATE_SHARE && shareNear(b.points, a.points) >= DUPLICATE_SHARE;
  return false;
}

/** Dubbletterna i kartan (`rows`: kartans synliga objekt med symbolnumret). */
export function duplicatePlan(rows: readonly DuplicateRow[]): DuplicatePlan {
  const shapes = rows.flatMap(row => shapeOf(row) ?? []);
  const removed = new Set<string>();
  const bySymbol = new Map<string, Shape[]>();
  for (const shape of shapes) bySymbol.set(shape.row.object.symbol, [...(bySymbol.get(shape.row.object.symbol) ?? []), shape]);
  for (const group of bySymbol.values()) {
    // Svep längs x; av två dubbletter står den största (längsta) kvar.
    const sorted = [...group].sort((a, b) => a.box.minX - b.box.minX);
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i]!;
      if (removed.has(a.row.key)) continue;
      for (let j = i + 1; j < sorted.length && sorted[j]!.box.minX <= a.box.maxX + POINT_TOLERANCE_MM; j += 1) {
        const b = sorted[j]!;
        if (removed.has(b.row.key) || !near(a.box, b.box, LINE_TOLERANCE_MM) || !same(a, b)) continue;
        const drop = b.size > a.size ? a : b;
        removed.add(drop.row.key);
        if (drop === a) break;
      }
    }
  }
  // Kapslat grönt: den ljusare tas bort när en mörkare täcker minst 90 % av den.
  const green = (shape: Shape) => { const { main, sub } = codeParts(shape.row.code); return sub === 0 ? NESTED_GREEN.indexOf(main as (typeof NESTED_GREEN)[number]) : -1; };
  const greens = shapes.filter(shape => shape.polygon && green(shape) >= 0 && !removed.has(shape.row.key));
  for (const light of greens) {
    const level = green(light);
    for (const dark of greens) {
      if (green(dark) <= level || removed.has(dark.row.key) || !near(light.box, dark.box, 0)) continue;
      if (boxOverlap(light.box, dark.box) < DUPLICATE_SHARE * light.size) continue;
      if (intersection(light.polygon!, dark.polygon!) >= DUPLICATE_SHARE * light.size) { removed.add(light.row.key); break; }
    }
  }
  const counts: Record<string, number> = {};
  for (const row of rows) if (removed.has(row.key)) counts[row.code] = (counts[row.code] ?? 0) + 1;
  return { remove: rows.filter(row => removed.has(row.key)).map(row => row.key), bySymbol: counts };
}

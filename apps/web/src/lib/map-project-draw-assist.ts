import type { Point } from "@o-tid/map-file";
import type { ObjectKey } from "@o-tid/map-revision";
import type { SnapExtra, SnapHit, SnapIndex, SnapTarget } from "./map-project-snap";

/**
 * K8b V5 (ägaren 2026-11-21): hjälp när man ritar. Ren geometri utan React; kartans mm med y uppåt.
 *
 * - Följ kant (håll Skift i Rita): från den senaste punkten, som är fäst på en linje eller ytkant, längs samma linje eller
 *   ring till punkten närmast pekaren; en sluten ring går den kortare vägen runt. Kurvor följs tätt utplattade (som i
 *   fästindexet, `flattenPath`).
 * - Vinkellås (håll ⌘/Ctrl): nästa sträcka i 45°-steg mot förra sträckan, i 90°-steg mot kanten som startpunkten är fäst på,
 *   annars i 45°-steg mot kartans norr. Med Fäst på fästs punkten där den låsta strålen skär närmaste linje.
 */

/** En linje eller ring ur fästindexet (utplattad) och om den är sluten. */
export interface IndexLine { readonly points: readonly Point[]; readonly closed: boolean }

/** Läget på en linje: sträckan `i` och var på den (0–1). */
export interface LinePosition { readonly i: number; readonly t: number; readonly at: Point; readonly distance: number }

/** Objektens nummer och delarnas sträckor i indexet (byggs en gång per index). */
const ranges = new WeakMap<SnapIndex, { objects: Map<ObjectKey, number>; parts: Map<string, [number, number]> }>();

function rangesOf(index: SnapIndex) {
  let found = ranges.get(index);
  if (found) return found;
  const objects = new Map<ObjectKey, number>();
  index.keys.forEach((key, object) => objects.set(key, object));
  const parts = new Map<string, [number, number]>();
  const info = index.segmentInfo;
  for (let item = 0; item < info.length / 3; item += 1) {
    const id = `${info[item * 3]}:${info[item * 3 + 1]}`, range = parts.get(id);
    if (range) range[1] = item + 1; else parts.set(id, [item, item + 1]);
  }
  found = { objects, parts };
  ranges.set(index, found);
  return found;
}

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/** Linjen eller ringen som fästpunkten ligger på (objektet och delen), ur indexet. Undefined för utkastet och punktobjekt. */
export function indexLine(index: SnapIndex, target: Pick<SnapTarget, "key" | "part">, near?: Point): IndexLine | undefined {
  if (target.key === undefined) return undefined;
  const { objects, parts } = rangesOf(index);
  const object = objects.get(target.key);
  const range = object === undefined ? undefined : parts.get(`${object}:${target.part}`);
  if (!range) return undefined;
  const s = index.segments;
  // Sträckorna i ordning; där de inte hänger ihop (flera linjer i delen) börjar en ny bit, och biten närmast `near` väljs.
  const runs: Point[][] = [];
  for (let item = range[0]; item < range[1]; item += 1) {
    const a = { x: s[item * 4]!, y: s[item * 4 + 1]! }, b = { x: s[item * 4 + 2]!, y: s[item * 4 + 3]! };
    const run = runs[runs.length - 1];
    if (run && same(run[run.length - 1]!, a)) run.push(b); else runs.push([a, b]);
  }
  const run = near && runs.length > 1 ? runs.reduce((best, next) => locate(next, near).distance < locate(best, near).distance ? next : best) : runs[0];
  if (!run || run.length < 2) return undefined;
  return { points: run, closed: run.length > 3 && same(run[0]!, run[run.length - 1]!) };
}

/** Närmaste läge på linjen för punkten. */
export function locate(points: readonly Point[], p: Point): LinePosition {
  let best: LinePosition = { i: 0, t: 0, at: points[0]!, distance: Infinity };
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!, b = points[i + 1]!, dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
    const at = { x: a.x + t * dx, y: a.y + t * dy }, distance = Math.hypot(p.x - at.x, p.y - at.y);
    if (distance < best.distance) best = { i, t, at, distance };
  }
  return best;
}

/**
 * Punkterna längs linjen från `from` till `to` (utan `from`, med `to` sist): brytpunkterna emellan och slutpunkten. En sluten
 * ring går den kortare vägen runt (räknat i längd).
 */
export function followLine(line: IndexLine, from: LinePosition, to: LinePosition): Point[] {
  const points = line.points, n = points.length - 1;
  const s0 = from.i + from.t, s1 = to.i + to.t;
  const cum = [0];
  for (let i = 0; i < n; i += 1) cum.push(cum[i]! + Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y));
  const along = (pos: LinePosition) => cum[pos.i]! + pos.t * (cum[pos.i + 1]! - cum[pos.i]!);
  const eps = 1e-9;
  let between: { v: number; d: number }[] = [];
  if (!line.closed) {
    const forward = s1 >= s0;
    for (let v = 1; v < n; v += 1) if (forward ? v > s0 + eps && v < s1 - eps : v < s0 - eps && v > s1 + eps) between.push({ v, d: Math.abs(v - s0) });
  } else {
    const total = cum[n]!, ahead = ((along(to) - along(from)) % total + total) % total;
    const forward = ahead <= total - ahead;
    const d1 = forward ? ((s1 - s0) % n + n) % n : ((s0 - s1) % n + n) % n;
    for (let v = 0; v < n; v += 1) {
      const d = forward ? ((v - s0) % n + n) % n : ((s0 - v) % n + n) % n;
      if (d > eps && d < d1 - eps) between.push({ v, d });
    }
  }
  between = between.sort((a, b) => a.d - b.d);
  return [...between.map(entry => ({ x: points[entry.v]!.x, y: points[entry.v]!.y })), to.at];
}

/** Följ kant: punkterna från fästpunkten `start` längs dess linje (eller skärningens andra linje) mot pekaren. */
export function followEdge(index: SnapIndex, start: SnapHit, pointer: Point): { points: Point[]; hit: SnapHit } | undefined {
  let best: { points: Point[]; hit: SnapHit; distance: number } | undefined;
  for (const target of [start.target, start.other]) {
    if (!target) continue;
    const line = indexLine(index, target, start.at);
    if (!line) continue;
    const from = locate(line.points, start.at), to = locate(line.points, pointer);
    if (from.distance > 1e-3 || (best && to.distance >= best.distance)) continue;
    const a = line.points[to.i]!, b = line.points[to.i + 1]!;
    const hit: SnapHit = { kind: "edge", at: to.at, distance: to.distance, target: { key: target.key, symbol: target.symbol, part: target.part, index: to.i, from: a, to: b, t: to.t } };
    best = { points: followLine(line, from, to), hit, distance: to.distance };
  }
  if (!best || (best.points.length === 1 && same(best.points[0]!, start.at))) return undefined;
  return { points: best.points, hit: best.hit };
}

/** Riktningen (radianer, 0 = öster, moturs) som vinkellåset räknar från, och stegets storlek. */
export interface AngleReference { readonly angle: number; readonly step: number; readonly kind: "segment" | "edge" | "north" }

const DEG = Math.PI / 180;

/**
 * Referensen för nästa sträcka: förra sträckan (45°-steg); för den första sträckan kanten som startpunkten är fäst på
 * (vinkelrätt eller parallellt, 90°-steg); annars kartans norr (45°-steg).
 */
export function angleReference(points: readonly Point[], start: SnapHit | undefined, index: SnapIndex | undefined): AngleReference {
  const last = points[points.length - 1], previous = points[points.length - 2];
  if (last && previous && !same(last, previous)) return { angle: Math.atan2(last.y - previous.y, last.x - previous.x), step: 45 * DEG, kind: "segment" };
  if (start && last && same(start.at, last)) {
    let from = start.target.from, to = start.target.to;
    if ((!from || !to) && index) {
      const line = indexLine(index, start.target, start.at);
      if (line) { const at = locate(line.points, start.at); from = line.points[at.i]; to = line.points[at.i + 1]; }
    }
    if (from && to && !same(from, to)) return { angle: Math.atan2(to.y - from.y, to.x - from.x), step: 90 * DEG, kind: "edge" };
  }
  return { angle: Math.PI / 2, step: 45 * DEG, kind: "north" };
}

/** Pekaren låst till närmaste tillåtna riktning från `origin`: riktningen (enhetsvektor) och punkten på strålen. */
export function lockAngle(origin: Point, pointer: Point, reference: AngleReference): { dir: Point; at: Point } {
  const dx = pointer.x - origin.x, dy = pointer.y - origin.y;
  const raw = Math.atan2(dy, dx), k = Math.round((raw - reference.angle) / reference.step);
  const angle = reference.angle + k * reference.step, dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const length = Math.max(0, dx * dir.x + dy * dir.y);
  return { dir, at: { x: origin.x + dir.x * length, y: origin.y + dir.y * length } };
}

/**
 * Fäst längs den låsta strålen: skärningen mellan strålen (från `origin` i riktningen `dir`) och närmaste linje eller ytkant
 * inom `reachMm` från `near` (den låsta punkten). Släckta och uteslutna objekt räknas inte; `extra` är utkastets sträckor.
 */
export function snapOnRay(index: SnapIndex | undefined, query: { origin: Point; dir: Point; near: Point; reachMm: number; hidden?: ReadonlySet<string> | undefined;
  exclude?: ReadonlySet<ObjectKey> | undefined; extra?: SnapExtra | undefined }): SnapHit | undefined {
  const { origin: o, dir: d, near, reachMm: reach } = query;
  if (!(reach > 0)) return undefined;
  let best: SnapHit | undefined;
  const consider = (a: Point, b: Point, target: () => SnapTarget) => {
    const sx = b.x - a.x, sy = b.y - a.y, denominator = d.x * sy - d.y * sx;
    if (Math.abs(denominator) < 1e-12) return;
    const qx = a.x - o.x, qy = a.y - o.y, s = (qx * sy - qy * sx) / denominator, u = (qx * d.y - qy * d.x) / denominator;
    if (s <= 1e-9 || u < -1e-9 || u > 1 + 1e-9) return;
    const at = { x: o.x + s * d.x, y: o.y + s * d.y }, distance = Math.hypot(at.x - near.x, at.y - near.y);
    if (distance <= reach && (!best || distance < best.distance)) best = { kind: "edge", at, distance, target: { ...target(), from: a, to: b, t: u } };
  };
  if (index) {
    const { minX, minY, cell, cols, rows } = index.grid;
    const c0 = Math.max(0, Math.floor((near.x - reach - minX) / cell)), c1 = Math.min(cols - 1, Math.floor((near.x + reach - minX) / cell));
    const r0 = Math.max(0, Math.floor((near.y - reach - minY) / cell)), r1 = Math.min(rows - 1, Math.floor((near.y + reach - minY) / cell));
    const seen = new Set<number>(), s = index.segments, info = index.segmentInfo;
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) {
      const cellIndex = r * cols + c;
      for (let i = index.segmentCells[cellIndex]!; i < index.segmentCells[cellIndex + 1]!; i += 1) {
        const item = index.segmentItems[i]!;
        if (seen.has(item)) continue;
        seen.add(item);
        const object = info[item * 3]!, key = index.keys[object]!, symbol = index.symbols[object]!;
        if (query.hidden?.has(symbol) || query.exclude?.has(key)) continue;
        consider({ x: s[item * 4]!, y: s[item * 4 + 1]! }, { x: s[item * 4 + 2]!, y: s[item * 4 + 3]! },
          () => ({ key, symbol, part: info[item * 3 + 1]!, index: info[item * 3 + 2]! }));
      }
    }
  }
  query.extra?.segments.forEach(([a, b], item) => consider(a, b, () => ({ key: undefined, symbol: undefined, part: 0, index: item })));
  return best;
}

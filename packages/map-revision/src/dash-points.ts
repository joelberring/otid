import { flattenPath, type LineSymbol, type MapObject, type MapSymbol, type Path, type PathCommand, type Point } from "@o-tid/map-file";
import { locatorKey } from "./contract";
import { objectBox, type Box } from "./hit";

/**
 * Styrpunkter (streckpunkter / dash points) för streckade linjer som hjälpkurvor (103.*), stigar och vägar (501–508.*).
 * Ren TypeScript utan I/O, i kartans mm med y uppåt.
 *
 * - Manuell redigering: växla styrpunkt på befintlig nod eller lägg in ny nod på rak sträcka eller kubisk Bézier
 *   (exakt de Casteljau-delning som bevarar kurvformen, hörnflaggor och luckor).
 * - Automatisk placering: skarpa böjar (noder och krökningstoppar på mjuka Bézierkurvor), slutna hjälpkurveslingor
 *   (minst 2 motsatta toppar), lutningsstreck (104.*) och korsningar/förgreningar mellan stigar och vägar.
 */

export type DashPointReason = "bend" | "slopeTag" | "junction";
export interface DashPointPlacement { readonly at: Point; readonly reason: DashPointReason }
export interface DashPointEntry { readonly id: string; readonly before: MapObject; readonly after: MapObject; readonly points: readonly DashPointPlacement[] }
export interface DashPointCounts { readonly objects: number; readonly added: number; readonly bends: number; readonly slopeTags: number; readonly junctions: number }
export interface DashPointOptions {
  readonly bends?: boolean;
  readonly slopeTags?: boolean;
  readonly junctions?: boolean;
  readonly keepExisting?: boolean;
  readonly bendAngleDeg?: number;
  readonly minSpacingMm?: number;
}
export interface AutoDashPointsPlan { readonly entries: readonly DashPointEntry[]; readonly counts: DashPointCounts }
export interface ToggleDashPointResult { readonly path: Path; readonly action: "added" | "removed" | "inserted"; readonly point: Point }

interface DashSymbolInfo {
  readonly mainLength: number;
  readonly mainGap: number;
  readonly isFormLine: boolean;
  readonly isSlopeTag: boolean;
  readonly isPath: boolean;
  readonly strokeColors: ReadonlySet<number>;
}
interface SubpathRange { readonly start: number; readonly end: number; readonly closed: boolean }
interface SamplePoint { readonly segIdx: number; readonly t: number; readonly s: number; readonly at: Point; readonly tangent: Point; readonly curvature: number }
interface Candidate {
  readonly subpathIdx: number;
  readonly segIdx: number;
  readonly t: number;
  readonly s: number;
  readonly at: Point;
  readonly reason: DashPointReason;
  readonly priority: number;
  readonly score: number;
  readonly vertexIdx?: number | undefined;
}
interface MicroSeg { readonly segIdx: number; readonly t0: number; readonly t1: number; readonly a: Point; readonly b: Point; readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number }
interface IndexedLine {
  readonly object: MapObject;
  readonly locator: string | undefined;
  readonly symbol: MapSymbol;
  readonly box: Box;
  readonly isSlopeTagCandidate: boolean;
  readonly isJunctionCandidate: boolean;
  readonly isFormLine: boolean;
  readonly strokeColors: ReadonlySet<number>;
  readonly endpoints: readonly Point[];
  readonly totalLength: number;
  readonly polylines: readonly (readonly Point[])[];
}

type Cubic = readonly [Point, Point, Point, Point];

const EPS = 1e-6;
const SAME_POINT_EPS = 1e-4;
const VERTEX_SNAP_EPS = 0.15;
const SLOPE_TAG_TOUCH_MM = 0.25;
const SLOPE_TAG_MAX_LEN_MM = 2.0;
const JUNCTION_TOUCH_MM = 0.45;
const GRID_CELL_MM = 12;

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const cmdPoint = (cmd: PathCommand): Point => ({ x: cmd.x, y: cmd.y });
const flagsOf = (cmd: PathCommand) => ({
  ...(cmd.corner ? { corner: true as const } : {}),
  ...(cmd.dash ? { dash: true as const } : {}),
  ...(cmd.gap !== undefined ? { gap: cmd.gap } : {})
});

function withDash(cmd: PathCommand, dash: boolean): PathCommand {
  const base = { ...(cmd.corner ? { corner: true as const } : {}), ...(dash ? { dash: true as const } : {}), ...(cmd.gap !== undefined ? { gap: cmd.gap } : {}) };
  return cmd.type === "C"
    ? { type: "C", x1: cmd.x1, y1: cmd.y1, x2: cmd.x2, y2: cmd.y2, x: cmd.x, y: cmd.y, ...base }
    : { type: cmd.type, x: cmd.x, y: cmd.y, ...base };
}

function cubicPoint([p0, p1, p2, p3]: Cubic, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
  };
}

function cubicDeriv1([p0, p1, p2, p3]: Cubic, t: number): Point {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
  };
}

function cubicDeriv2([p0, p1, p2, p3]: Cubic, t: number): Point {
  const u = 1 - t;
  return {
    x: 6 * u * (p2.x - 2 * p1.x + p0.x) + 6 * t * (p3.x - 2 * p2.x + p1.x),
    y: 6 * u * (p2.y - 2 * p1.y + p0.y) + 6 * t * (p3.y - 2 * p2.y + p1.y)
  };
}

function cubicCurvature(cubic: Cubic, t: number): number {
  const d1 = cubicDeriv1(cubic, t), speed = Math.hypot(d1.x, d1.y);
  if (speed < EPS) return 0;
  const d2 = cubicDeriv2(cubic, t);
  return Math.abs(d1.x * d2.y - d1.y * d2.x) / (speed * speed * speed);
}

function splitCubic([p0, p1, p2, p3]: Cubic, t: number): [Cubic, Cubic] {
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
  const d = lerp(a, b, t), e = lerp(b, c, t), m = lerp(d, e, t);
  return [[p0, a, d, m], [m, e, c, p3]];
}

function nearestOnCubic(cubic: Cubic, target: Point): { t: number; at: Point; distance: number } {
  let bestT = 0, bestD = Infinity;
  for (let i = 0; i <= 32; i += 1) {
    const t = i / 32, d = dist(cubicPoint(cubic, t), target);
    if (d < bestD) { bestD = d; bestT = t; }
  }
  for (let step = 1 / 64; step > 1e-5; step /= 2) {
    for (const candidate of [bestT - step, bestT + step]) {
      if (candidate < 0 || candidate > 1) continue;
      const d = dist(cubicPoint(cubic, candidate), target);
      if (d < bestD) { bestD = d; bestT = candidate; }
    }
  }
  const at = cubicPoint(cubic, bestT);
  return { t: bestT, at, distance: dist(at, target) };
}

function nearestOnLine(a: Point, b: Point, target: Point): { t: number; at: Point; distance: number } {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / len2)) : 0;
  const at = { x: a.x + dx * t, y: a.y + dy * t };
  return { t, at, distance: dist(at, target) };
}

function dashSymbolInfo(symbol: MapSymbol | undefined): DashSymbolInfo | undefined {
  if (!symbol || symbol.kind !== "LINE") return undefined;
  let mainLength = 0, mainGap = 0, hasDash = false;
  for (const stroke of symbol.strokes) {
    if (stroke.dashSpec && stroke.dashSpec.mainLength > 0) {
      mainLength = stroke.dashSpec.mainLength;
      mainGap = stroke.dashSpec.mainGap > 0 ? stroke.dashSpec.mainGap : (stroke.dashSpec.secondaryGap ?? 0);
      hasDash = true;
      break;
    }
    if (stroke.dash && stroke.dash.length > 0) {
      mainLength = stroke.dash[0] ?? 0;
      mainGap = stroke.dash[1] ?? stroke.dash[0] ?? 0;
      hasDash = true;
      break;
    }
  }
  if (!hasDash) return undefined;
  const main = symbol.code.main;
  return { mainLength, mainGap, isFormLine: main === 103, isSlopeTag: main === 104, isPath: main >= 501 && main <= 508, strokeColors: new Set(symbol.strokes.map(s => s.color)) };
}

/** Sant om symbolen är en linjesymbol med minst ett streckat streck (`dashSpec` eller icke-tom `dash`). */
export function isDashedLineSymbol(symbol: MapSymbol | undefined): symbol is LineSymbol {
  return dashSymbolInfo(symbol) !== undefined;
}

/** Växlar styrpunktsflaggan (`dash`) på ankarpunkten `commandIndex`, med bibehållna hörn-, luck- och Béziervärden. */
export function toggleDashPoint(path: Path, commandIndex: number): Path {
  const cmd = path[commandIndex];
  if (!cmd) return path;
  const next = [...path];
  next[commandIndex] = withDash(cmd, !cmd.dash);
  return next;
}

/**
 * Växlar en styrpunkt på befintlig nod inom `snapMm`, eller delar närmaste raka sträcka / kubiska Bézier
 * (via de Casteljau) och sätter `dash: true` på den nya punkten.
 */
export function toggleOrInsertDashPoint(path: Path, at: Point, snapMm = 0.45): ToggleDashPointResult {
  if (path.length === 0) return { path, action: "removed", point: at };

  let bestVertexIdx = -1, bestVertexDist = Infinity;
  for (let i = 0; i < path.length; i += 1) {
    const d = dist(cmdPoint(path[i]!), at);
    if (d <= snapMm && d < bestVertexDist) { bestVertexDist = d; bestVertexIdx = i; }
  }
  if (bestVertexIdx >= 0) {
    const cmd = path[bestVertexIdx]!, removing = Boolean(cmd.dash), next = [...path];
    next[bestVertexIdx] = withDash(cmd, !removing);
    if (removing) {
      const p = cmdPoint(cmd);
      for (let i = 0; i < next.length; i += 1) {
        if (i !== bestVertexIdx && next[i]!.dash && dist(cmdPoint(next[i]!), p) <= SAME_POINT_EPS) next[i] = withDash(next[i]!, false);
      }
    }
    return { path: next, action: removing ? "removed" : "added", point: cmdPoint(cmd) };
  }

  let bestSeg: { index: number; t: number; at: Point; distance: number } | undefined;
  for (let i = 1; i < path.length; i += 1) {
    const cmd = path[i]!;
    if (cmd.type === "M") continue;
    const prev = cmdPoint(path[i - 1]!);
    const hit = cmd.type === "C" ? nearestOnCubic([prev, { x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 }, cmdPoint(cmd)], at) : nearestOnLine(prev, cmdPoint(cmd), at);
    if (!bestSeg || hit.distance < bestSeg.distance) bestSeg = { index: i, ...hit };
  }
  if (!bestSeg) {
    const only = path[0]!;
    return { path: toggleDashPoint(path, 0), action: only.dash ? "removed" : "added", point: cmdPoint(only) };
  }
  if (bestSeg.t <= 1e-4 || bestSeg.t >= 1 - 1e-4) {
    const idx = bestSeg.t <= 1e-4 ? bestSeg.index - 1 : bestSeg.index, cmd = path[idx]!;
    return { path: toggleDashPoint(path, idx), action: cmd.dash ? "removed" : "added", point: cmdPoint(cmd) };
  }

  const end = path[bestSeg.index]!, start = cmdPoint(path[bestSeg.index - 1]!), halfGap = end.gap !== undefined ? { gap: end.gap } : {}, next = [...path];
  if (end.type === "C") {
    const [left, right] = splitCubic([start, { x: end.x1, y: end.y1 }, { x: end.x2, y: end.y2 }, cmdPoint(end)], bestSeg.t);
    next.splice(bestSeg.index, 1,
      { type: "C", x1: left[1].x, y1: left[1].y, x2: left[2].x, y2: left[2].y, x: left[3].x, y: left[3].y, ...halfGap, dash: true },
      { type: "C", x1: right[1].x, y1: right[1].y, x2: right[2].x, y2: right[2].y, x: right[3].x, y: right[3].y, ...flagsOf(end) });
    return { path: next, action: "inserted", point: left[3] };
  }
  const mid = lerp(start, cmdPoint(end), bestSeg.t);
  next.splice(bestSeg.index, 0, { type: "L", x: mid.x, y: mid.y, ...halfGap, dash: true });
  return { path: next, action: "inserted", point: mid };
}

function subpathRanges(path: Path): SubpathRange[] {
  const ranges: SubpathRange[] = [];
  let start = 0;
  for (let i = 1; i <= path.length; i += 1) {
    if (i === path.length || path[i]!.type === "M") {
      const end = i - 1;
      const closed = end - start >= 2 && dist(cmdPoint(path[start]!), cmdPoint(path[end]!)) <= SAME_POINT_EPS;
      ranges.push({ start, end, closed });
      start = i;
    }
  }
  return ranges;
}

function angleDegBetween(a: Point, b: Point): number {
  const la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
  if (la < EPS || lb < EPS) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (la * lb)))) * (180 / Math.PI);
}

function incomingTangent(path: Path, cmdIdx: number): Point {
  const cmd = path[cmdIdx]!, prev = cmdPoint(path[cmdIdx - 1]!), curr = cmdPoint(cmd);
  if (cmd.type === "C") {
    const v1 = { x: curr.x - cmd.x2, y: curr.y - cmd.y2 };
    if (Math.hypot(v1.x, v1.y) > EPS) return v1;
    const v2 = { x: curr.x - cmd.x1, y: curr.y - cmd.y1 };
    if (Math.hypot(v2.x, v2.y) > EPS) return v2;
  }
  return { x: curr.x - prev.x, y: curr.y - prev.y };
}

function outgoingTangent(path: Path, cmdIdx: number): Point {
  const curr = cmdPoint(path[cmdIdx]!), next = path[cmdIdx + 1]!;
  if (next.type === "C") {
    const v1 = { x: next.x1 - curr.x, y: next.y1 - curr.y };
    if (Math.hypot(v1.x, v1.y) > EPS) return v1;
    const v2 = { x: next.x2 - curr.x, y: next.y2 - curr.y };
    if (Math.hypot(v2.x, v2.y) > EPS) return v2;
  }
  return { x: next.x - curr.x, y: next.y - curr.y };
}

function sampleSubpath(path: Path, range: SubpathRange) {
  const samples: SamplePoint[] = [];
  const vertexArcLengths = new Map<number, number>([[range.start, 0]]);
  const segCumStart = new Map<number, number>(), segLength = new Map<number, number>();
  const microSegs: MicroSeg[] = [];
  let s = 0;

  for (let i = range.start + 1; i <= range.end; i += 1) {
    const cmd = path[i]!, p0 = cmdPoint(path[i - 1]!), pEnd = cmdPoint(cmd), segStartS = s;
    segCumStart.set(i, s);
    if (cmd.type === "C") {
      const cubic: Cubic = [p0, { x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 }, pEnd];
      const chord = dist(p0, cubic[1]) + dist(cubic[1], cubic[2]) + dist(cubic[2], pEnd);
      const steps = Math.max(12, Math.min(48, Math.ceil(chord / 0.25)));
      if (samples.length === 0) samples.push({ segIdx: i, t: 0, s: 0, at: p0, tangent: cubicDeriv1(cubic, 0), curvature: cubicCurvature(cubic, 0) });
      let prevPt = p0, prevT = 0;
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps, pt = cubicPoint(cubic, t);
        s += dist(prevPt, pt);
        samples.push({ segIdx: i, t, s, at: pt, tangent: cubicDeriv1(cubic, t), curvature: cubicCurvature(cubic, t) });
        microSegs.push({ segIdx: i, t0: prevT, t1: t, a: prevPt, b: pt, minX: Math.min(prevPt.x, pt.x), maxX: Math.max(prevPt.x, pt.x), minY: Math.min(prevPt.y, pt.y), maxY: Math.max(prevPt.y, pt.y) });
        prevPt = pt; prevT = t;
      }
    } else {
      const tang = { x: pEnd.x - p0.x, y: pEnd.y - p0.y };
      if (samples.length === 0) samples.push({ segIdx: i, t: 0, s: 0, at: p0, tangent: tang, curvature: 0 });
      s += dist(p0, pEnd);
      samples.push({ segIdx: i, t: 1, s, at: pEnd, tangent: tang, curvature: 0 });
      microSegs.push({ segIdx: i, t0: 0, t1: 1, a: p0, b: pEnd, minX: Math.min(p0.x, pEnd.x), maxX: Math.max(p0.x, pEnd.x), minY: Math.min(p0.y, pEnd.y), maxY: Math.max(p0.y, pEnd.y) });
    }
    segLength.set(i, s - segStartS);
    vertexArcLengths.set(i, s);
  }
  return { samples, vertexArcLengths, segCumStart, segLength, microSegs, totalLength: s };
}

function arcLengthAt(path: Path, segIdx: number, t: number, segCumStart: ReadonlyMap<number, number>, segLength: ReadonlyMap<number, number>): number {
  const startS = segCumStart.get(segIdx) ?? 0, cmd = path[segIdx];
  if (!cmd || cmd.type !== "C") return startS + (segLength.get(segIdx) ?? 0) * t;
  const p0 = cmdPoint(path[segIdx - 1]!), cubic: Cubic = [p0, { x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 }, cmdPoint(cmd)];
  let len = 0, prev = p0;
  for (let i = 1; i <= 16; i += 1) {
    const pt = cubicPoint(cubic, (t * i) / 16);
    len += dist(prev, pt); prev = pt;
  }
  return startS + len;
}

function refineCurvaturePeak(cubic: Cubic, lo: number, hi: number): { t: number; curvature: number } {
  let a = Math.max(0.01, lo), b = Math.min(0.99, hi);
  for (let iter = 0; iter < 12; iter += 1) {
    const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
    if (cubicCurvature(cubic, m1) < cubicCurvature(cubic, m2)) a = m1; else b = m2;
  }
  const t = (a + b) / 2;
  return { t, curvature: cubicCurvature(cubic, t) };
}

function sampleAtArcLength(samples: readonly SamplePoint[], targetS: number, totalLength: number, closed: boolean): SamplePoint {
  const s = closed && totalLength > EPS ? ((targetS % totalLength) + totalLength) % totalLength : Math.max(0, Math.min(totalLength, targetS));
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (samples[mid]!.s < s) lo = mid + 1; else hi = mid; }
  return samples[lo]!;
}

const circularArcDist = (a: number, b: number, totalLength: number, closed: boolean) => {
  const d = Math.abs(a - b);
  return closed ? Math.min(d, Math.max(0, totalLength - d)) : d;
};
const boxesOverlap = (a: Box, b: Box, pad: number) => a.minX <= b.maxX + pad && b.minX <= a.maxX + pad && a.minY <= b.maxY + pad && b.minY <= a.maxY + pad;

function segmentIntersection(a: Point, b: Point, c: Point, d: Point): { u: number; at: Point } | undefined {
  const rX = b.x - a.x, rY = b.y - a.y, sX = d.x - c.x, sY = d.y - c.y, denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-10) return undefined;
  const qpx = c.x - a.x, qpy = c.y - a.y, u = (qpx * sY - qpy * sX) / denom, v = (qpx * rY - qpy * rX) / denom;
  if (u < -1e-9 || u > 1 + 1e-9 || v < -1e-9 || v > 1 + 1e-9) return undefined;
  const cu = Math.max(0, Math.min(1, u));
  return { u: cu, at: { x: a.x + cu * rX, y: a.y + cu * rY } };
}

function buildSpatialGrid(allObjects: readonly MapObject[], symbols: ReadonlyMap<string, MapSymbol>, needSlopeTags: boolean, needJunctions: boolean) {
  const lines: IndexedLine[] = [];
  const grid = new Map<string, number[]>();
  if (!needSlopeTags && !needJunctions) return { lines, grid };

  for (const obj of allObjects) {
    if (obj.kind !== "line" || obj.path.length < 2) continue;
    const sym = symbols.get(obj.symbol);
    if (!sym || sym.hidden || sym.kind !== "LINE") continue;
    const main = sym.code.main, dashed = dashSymbolInfo(sym) !== undefined;
    const maybeSlopeTag = needSlopeTags && (main === 104 || (!dashed && ((main >= 101 && main <= 115) || sym.strokes.length > 0)));
    const maybeJunction = needJunctions && ((main >= 501 && main <= 509) || dashed);
    if (!maybeSlopeTag && !maybeJunction) continue;

    const polylines = flattenPath(obj.path).filter(p => p.length >= 2);
    if (polylines.length === 0) continue;
    let totalLength = 0;
    const endpoints: Point[] = [];
    for (const pl of polylines) {
      endpoints.push(pl[0]!, pl[pl.length - 1]!);
      for (let i = 1; i < pl.length; i += 1) totalLength += dist(pl[i - 1]!, pl[i]!);
    }
    const isSlopeTagCandidate = needSlopeTags && (main === 104 || (!dashed && totalLength <= SLOPE_TAG_MAX_LEN_MM));
    if (!isSlopeTagCandidate && !maybeJunction) continue;

    const box = objectBox(obj), idx = lines.length;
    lines.push({
      object: obj, locator: obj.source ? locatorKey(obj.source.locator) : undefined, symbol: sym, box,
      isSlopeTagCandidate, isJunctionCandidate: maybeJunction, isFormLine: main === 103,
      strokeColors: new Set(sym.strokes.map(s => s.color)), endpoints, totalLength, polylines
    });
    for (let cx = Math.floor(box.minX / GRID_CELL_MM); cx <= Math.floor(box.maxX / GRID_CELL_MM); cx += 1) {
      for (let cy = Math.floor(box.minY / GRID_CELL_MM); cy <= Math.floor(box.maxY / GRID_CELL_MM); cy += 1) {
        const key = `${cx},${cy}`;
        let bucket = grid.get(key);
        if (!bucket) { bucket = []; grid.set(key, bucket); }
        bucket.push(idx);
      }
    }
  }
  return { lines, grid };
}

function queryGrid(grid: ReadonlyMap<string, readonly number[]>, box: Box, pad: number): number[] {
  const seen = new Set<number>(), out: number[] = [];
  for (let cx = Math.floor((box.minX - pad) / GRID_CELL_MM); cx <= Math.floor((box.maxX + pad) / GRID_CELL_MM); cx += 1) {
    for (let cy = Math.floor((box.minY - pad) / GRID_CELL_MM); cy <= Math.floor((box.maxY + pad) / GRID_CELL_MM); cy += 1) {
      for (const idx of grid.get(`${cx},${cy}`) ?? []) if (!seen.has(idx)) { seen.add(idx); out.push(idx); }
    }
  }
  return out;
}

function nearestOnSubpath(path: Path, range: SubpathRange, target: Point) {
  let best: { segIdx: number; t: number; at: Point; distance: number } | undefined;
  for (let i = range.start + 1; i <= range.end; i += 1) {
    const cmd = path[i]!, prev = cmdPoint(path[i - 1]!);
    const hit = cmd.type === "C" ? nearestOnCubic([prev, { x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 }, cmdPoint(cmd)], target) : nearestOnLine(prev, cmdPoint(cmd), target);
    if (!best || hit.distance < best.distance) best = { segIdx: i, ...hit };
  }
  return best;
}

function pathsEqual(a: Path, b: Path): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const ca = a[i]!, cb = b[i]!;
    if (ca.type !== cb.type || ca.x !== cb.x || ca.y !== cb.y || Boolean(ca.dash) !== Boolean(cb.dash) || Boolean(ca.corner) !== Boolean(cb.corner) || ca.gap !== cb.gap) return false;
    if (ca.type === "C" && cb.type === "C" && (ca.x1 !== cb.x1 || ca.y1 !== cb.y1 || ca.x2 !== cb.x2 || ca.y2 !== cb.y2)) return false;
  }
  return true;
}

function applyAcceptedCandidates(basePath: Path, ranges: readonly SubpathRange[], accepted: readonly Candidate[]): { path: Path; placements: DashPointPlacement[] } {
  const markVertices = new Set<number>();
  const splitsBySeg = new Map<number, { t: number; at: Point; reason: DashPointReason }[]>();
  const placements: DashPointPlacement[] = [];

  for (const cand of accepted) {
    const range = ranges[cand.subpathIdx]!;
    let snappedVertex = cand.vertexIdx;
    if (snappedVertex === undefined) {
      if (cand.t <= 1e-3 || dist(cand.at, cmdPoint(basePath[cand.segIdx - 1]!)) <= VERTEX_SNAP_EPS) snappedVertex = cand.segIdx - 1;
      else if (cand.t >= 1 - 1e-3 || dist(cand.at, cmdPoint(basePath[cand.segIdx]!)) <= VERTEX_SNAP_EPS) snappedVertex = cand.segIdx;
    }
    if (snappedVertex !== undefined) {
      if (!range.closed && (snappedVertex === range.start || snappedVertex === range.end)) continue;
      const canonical = range.closed && snappedVertex === range.end ? range.start : snappedVertex;
      if (!basePath[canonical]!.dash && !markVertices.has(canonical)) {
        markVertices.add(canonical);
        placements.push({ at: cmdPoint(basePath[canonical]!), reason: cand.reason });
      }
    } else {
      let list = splitsBySeg.get(cand.segIdx);
      if (!list) { list = []; splitsBySeg.set(cand.segIdx, list); }
      list.push({ t: cand.t, at: cand.at, reason: cand.reason });
      placements.push({ at: cand.at, reason: cand.reason });
    }
  }

  const out: PathCommand[] = [];
  for (let i = 0; i < basePath.length; i += 1) {
    const cmd = basePath[i]!, splits = splitsBySeg.get(i);
    if (!splits || splits.length === 0 || i === 0 || cmd.type === "M") {
      out.push(markVertices.has(i) ? withDash(cmd, true) : cmd);
      continue;
    }
    const sorted = [...splits].sort((a, b) => a.t - b.t), startPt = cmdPoint(basePath[i - 1]!);
    const endCmd = markVertices.has(i) ? withDash(cmd, true) : cmd, halfGap = cmd.gap !== undefined ? { gap: cmd.gap } : {};
    if (cmd.type === "C") {
      let rem: Cubic = [startPt, { x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 }, cmdPoint(cmd)], prevT = 0;
      for (const sp of sorted) {
        if (1 - prevT <= EPS) continue;
        const localT = Math.max(1e-4, Math.min(1 - 1e-4, (sp.t - prevT) / (1 - prevT)));
        const [left, right] = splitCubic(rem, localT);
        out.push({ type: "C", x1: left[1].x, y1: left[1].y, x2: left[2].x, y2: left[2].y, x: left[3].x, y: left[3].y, ...halfGap, dash: true });
        rem = right; prevT = sp.t;
      }
      out.push({ type: "C", x1: rem[1].x, y1: rem[1].y, x2: rem[2].x, y2: rem[2].y, x: rem[3].x, y: rem[3].y, ...flagsOf(endCmd) });
    } else {
      const endPt = cmdPoint(cmd);
      for (const sp of sorted) {
        const pt = lerp(startPt, endPt, sp.t);
        out.push({ type: "L", x: pt.x, y: pt.y, ...halfGap, dash: true });
      }
      out.push(endCmd);
    }
  }
  return { path: out, placements };
}

/**
 * Beräknar automatiska styrpunkter för `targets` (streckade linjer) med hänsyn till skarpa böjar,
 * lutningsstreck (104.*) och korsningar/förgreningar mot övriga objekt i `allObjects`.
 */
export function autoDashPointsPlan(
  targets: readonly MapObject[],
  allObjects: readonly MapObject[],
  symbols: ReadonlyMap<string, MapSymbol>,
  options?: DashPointOptions
): AutoDashPointsPlan {
  const enableBends = options?.bends !== false, enableSlopeTags = options?.slopeTags !== false;
  const enableJunctions = options?.junctions !== false, keepExisting = options?.keepExisting !== false;
  const { lines: indexedLines, grid } = buildSpatialGrid(allObjects, symbols, enableSlopeTags, enableJunctions);

  const entries: DashPointEntry[] = [];
  let totalAdded = 0, totalBends = 0, totalSlopeTags = 0, totalJunctions = 0;

  for (let targetIdx = 0; targetIdx < targets.length; targetIdx += 1) {
    const target = targets[targetIdx]!;
    if (target.kind !== "line" || target.path.length < 2) continue;
    const info = dashSymbolInfo(symbols.get(target.symbol));
    if (!info) continue;

    const basePath: Path = keepExisting ? target.path : target.path.map(cmd => (cmd.dash ? withDash(cmd, false) : cmd));
    const ranges = subpathRanges(basePath), sampled = ranges.map(range => sampleSubpath(basePath, range));
    const bendThreshold = options?.bendAngleDeg ?? (info.isPath ? 40 : 35);
    const minSpacing = options?.minSpacingMm ?? Math.max(0.8, (info.mainLength + info.mainGap) * 0.65);
    const curveWindow = Math.max(1.2, Math.max(1.0, info.mainLength + info.mainGap) * 0.75);
    const candidates: Candidate[] = [];

    if (enableBends) {
      for (let rIdx = 0; rIdx < ranges.length; rIdx += 1) {
        const range = ranges[rIdx]!, data = sampled[rIdx]!;
        if (data.totalLength < EPS) continue;
        for (let i = range.closed ? range.start : range.start + 1; i <= range.end - 1; i += 1) {
          const angle = angleDegBetween(incomingTangent(basePath, i === range.start ? range.end : i), outgoingTangent(basePath, i));
          if (angle >= bendThreshold) {
            candidates.push({
              subpathIdx: rIdx, segIdx: i === range.start ? range.start + 1 : i, t: i === range.start ? 0 : 1,
              s: data.vertexArcLengths.get(i) ?? 0, at: cmdPoint(basePath[i]!), reason: "bend", priority: 1, score: angle, vertexIdx: i
            });
          }
        }
        const { samples } = data;
        for (let k = 1; k + 1 < samples.length; k += 1) {
          const cur = samples[k]!, cmd = basePath[cur.segIdx]!;
          if (cmd.type !== "C" || cur.curvature < 0.35 || cur.curvature < samples[k - 1]!.curvature || cur.curvature < samples[k + 1]!.curvature) continue;
          const cubic: Cubic = [cmdPoint(basePath[cur.segIdx - 1]!), { x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 }, cmdPoint(cmd)];
          const peak = refineCurvaturePeak(cubic, samples[k - 1]!.segIdx === cur.segIdx ? samples[k - 1]!.t : 0, samples[k + 1]!.segIdx === cur.segIdx ? samples[k + 1]!.t : 1);
          const peakS = arcLengthAt(basePath, cur.segIdx, peak.t, data.segCumStart, data.segLength);
          const windowTurn = angleDegBetween(
            sampleAtArcLength(samples, peakS - curveWindow, data.totalLength, range.closed).tangent,
            sampleAtArcLength(samples, peakS + curveWindow, data.totalLength, range.closed).tangent
          );
          if (windowTurn >= bendThreshold) {
            candidates.push({ subpathIdx: rIdx, segIdx: cur.segIdx, t: peak.t, s: peakS, at: cubicPoint(cubic, peak.t), reason: "bend", priority: 1, score: windowTurn + peak.curvature * 10 });
          }
        }
      }
    }

    if ((enableSlopeTags && info.isFormLine) || enableJunctions) {
      const targetBox = objectBox(target), targetLocator = target.source ? locatorKey(target.source.locator) : undefined;
      for (const otherIdx of queryGrid(grid, targetBox, JUNCTION_TOUCH_MM)) {
        const other = indexedLines[otherIdx]!;
        if (other.object === target || (targetLocator && other.locator === targetLocator) || !boxesOverlap(targetBox, other.box, JUNCTION_TOUCH_MM)) continue;

        if (enableSlopeTags && info.isFormLine && other.isSlopeTagCandidate && boxesOverlap(targetBox, other.box, SLOPE_TAG_TOUCH_MM)) {
          const isContourBrown = (other.symbol.code.main >= 101 && other.symbol.code.main <= 115) || [...other.strokeColors].some(c => info.strokeColors.has(c));
          if (other.symbol.code.main === 104 || (other.totalLength <= SLOPE_TAG_MAX_LEN_MM && isContourBrown)) {
            let bestTouch: { rIdx: number; segIdx: number; t: number; at: Point; distance: number } | undefined;
            for (const ep of other.endpoints) for (let rIdx = 0; rIdx < ranges.length; rIdx += 1) {
              const hit = nearestOnSubpath(basePath, ranges[rIdx]!, ep);
              if (hit && hit.distance <= SLOPE_TAG_TOUCH_MM && (!bestTouch || hit.distance < bestTouch.distance)) bestTouch = { rIdx, ...hit };
            }
            if (bestTouch) {
              const data = sampled[bestTouch.rIdx]!;
              candidates.push({
                subpathIdx: bestTouch.rIdx, segIdx: bestTouch.segIdx, t: bestTouch.t,
                s: arcLengthAt(basePath, bestTouch.segIdx, bestTouch.t, data.segCumStart, data.segLength),
                at: bestTouch.at, reason: "slopeTag", priority: 3, score: 1000 - bestTouch.distance
              });
            }
          }
        }

        if (enableJunctions && other.isJunctionCandidate && (info.isFormLine ? other.isFormLine : !other.isFormLine)) {
          for (const ep of other.endpoints) for (let rIdx = 0; rIdx < ranges.length; rIdx += 1) {
            const hit = nearestOnSubpath(basePath, ranges[rIdx]!, ep);
            if (hit && hit.distance <= JUNCTION_TOUCH_MM) {
              const data = sampled[rIdx]!;
              candidates.push({
                subpathIdx: rIdx, segIdx: hit.segIdx, t: hit.t,
                s: arcLengthAt(basePath, hit.segIdx, hit.t, data.segCumStart, data.segLength),
                at: hit.at, reason: "junction", priority: 2, score: 500 - hit.distance
              });
            }
          }
          if (boxesOverlap(targetBox, other.box, 0)) {
            for (let rIdx = 0; rIdx < ranges.length; rIdx += 1) {
              const data = sampled[rIdx]!;
              for (const ms of data.microSegs) {
                if (ms.maxX < other.box.minX || ms.minX > other.box.maxX || ms.maxY < other.box.minY || ms.minY > other.box.maxY) continue;
                for (const pl of other.polylines) for (let k = 1; k < pl.length; k += 1) {
                  const c = pl[k - 1]!, d = pl[k]!;
                  if (Math.max(c.x, d.x) < ms.minX || Math.min(c.x, d.x) > ms.maxX || Math.max(c.y, d.y) < ms.minY || Math.min(c.y, d.y) > ms.maxY) continue;
                  const hit = segmentIntersection(ms.a, ms.b, c, d);
                  if (!hit) continue;
                  const t = ms.t0 + (ms.t1 - ms.t0) * hit.u, cmd = basePath[ms.segIdx]!;
                  const exactAt = cmd.type === "C" ? cubicPoint([cmdPoint(basePath[ms.segIdx - 1]!), { x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 }, cmdPoint(cmd)], t) : hit.at;
                  candidates.push({
                    subpathIdx: rIdx, segIdx: ms.segIdx, t,
                    s: arcLengthAt(basePath, ms.segIdx, t, data.segCumStart, data.segLength),
                    at: exactAt, reason: "junction", priority: 2, score: 600
                  });
                }
              }
            }
          }
        }
      }
    }

    const accepted: Candidate[] = [];
    for (let rIdx = 0; rIdx < ranges.length; rIdx += 1) {
      const range = ranges[rIdx]!, data = sampled[rIdx]!, occupiedS: number[] = [];
      if (keepExisting) {
        const lastIdx = range.closed ? range.end - 1 : range.end;
        for (let i = range.start; i <= lastIdx; i += 1) {
          if ((basePath[i]!.dash || basePath[i]!.corner) && (range.closed || (i !== range.start && i !== range.end))) {
            occupiedS.push(data.vertexArcLengths.get(i) ?? 0);
          }
        }
      }
      for (const cand of candidates.filter(c => c.subpathIdx === rIdx).sort((a, b) => b.priority - a.priority || b.score - a.score)) {
        if (!range.closed && cand.reason === "bend") {
          const endMargin = Math.min(minSpacing * 0.5, data.totalLength * 0.2);
          if (cand.s <= endMargin || cand.s >= data.totalLength - endMargin) continue;
        }
        if (!range.closed && (cand.s <= VERTEX_SNAP_EPS || cand.s >= data.totalLength - VERTEX_SNAP_EPS)) continue;
        if (occupiedS.some(s => circularArcDist(s, cand.s, data.totalLength, range.closed) < minSpacing)) continue;
        occupiedS.push(cand.s);
        accepted.push(cand);
      }

      if (enableBends && info.isFormLine && range.closed && occupiedS.length < 2 && data.totalLength >= 0.4) {
        const pickBestSample = (excludeS?: number): SamplePoint | undefined => {
          let best: SamplePoint | undefined, bestScore = -1;
          for (const sp of data.samples) {
            if (excludeS !== undefined) {
              const d = circularArcDist(sp.s, excludeS, data.totalLength, true);
              if (d < data.totalLength * 0.3 || d > data.totalLength * 0.7) continue;
            }
            if (sp.curvature > bestScore) { bestScore = sp.curvature; best = sp; }
          }
          if (best && bestScore > EPS) return best;
          return sampleAtArcLength(data.samples, excludeS !== undefined ? (excludeS + data.totalLength / 2) % data.totalLength : 0, data.totalLength, true);
        };
        if (occupiedS.length === 0) {
          const first = pickBestSample();
          if (first) {
            occupiedS.push(first.s);
            accepted.push({ subpathIdx: rIdx, segIdx: first.segIdx, t: first.t, s: first.s, at: first.at, reason: "bend", priority: 1, score: first.curvature });
          }
        }
        if (occupiedS.length === 1) {
          const second = pickBestSample(occupiedS[0]);
          if (second) {
            occupiedS.push(second.s);
            accepted.push({ subpathIdx: rIdx, segIdx: second.segIdx, t: second.t, s: second.s, at: second.at, reason: "bend", priority: 1, score: second.curvature });
          }
        }
      }
    }

    const { path: nextPath, placements } = applyAcceptedCandidates(basePath, ranges, accepted);
    if (pathsEqual(target.path, nextPath)) continue;
    const after: MapObject = { ...target, path: nextPath };
    entries.push({ id: target.source ? `b:${locatorKey(target.source.locator)}` : `x:${targetIdx}`, before: target, after, points: placements });
    totalAdded += placements.length;
    for (const p of placements) {
      if (p.reason === "bend") totalBends += 1;
      else if (p.reason === "slopeTag") totalSlopeTags += 1;
      else totalJunctions += 1;
    }
  }

  return { entries, counts: { objects: entries.length, added: totalAdded, bends: totalBends, slopeTags: totalSlopeTags, junctions: totalJunctions } };
}

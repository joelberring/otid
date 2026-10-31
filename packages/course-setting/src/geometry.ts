/** Plangeometri i kartans mm (y uppåt). */
import type { Point } from "@o-tid/map-file";

export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** Vinkel i grader moturs från x-axeln. */
export const angleDegrees = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;

export const polar = (center: Point, radius: number, degrees: number): Point => ({
  x: center.x + radius * Math.cos(degrees * Math.PI / 180),
  y: center.y + radius * Math.sin(degrees * Math.PI / 180)
});

/** Punkten `length` mm från `from` mot `to`. */
export function alongLine(from: Point, to: Point, length: number): Point {
  const d = distance(from, to);
  if (d === 0) return from;
  return { x: from.x + (to.x - from.x) * length / d, y: from.y + (to.y - from.y) * length / d };
}

/** Närmaste punkt på sträckan a–b och avståndet dit. */
export function nearestOnSegment(p: Point, a: Point, b: Point): { point: Point; distance: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, distance: distance(p, point), t };
}

/** Avståndet från punkten till linjen och läget längs linjen (mm från början). */
export function nearestOnPath(p: Point, path: readonly Point[]): { distance: number; along: number; point: Point } {
  let best = { distance: Infinity, along: 0, point: path[0]! };
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const hit = nearestOnSegment(p, a, b);
    if (hit.distance < best.distance) best = { distance: hit.distance, along: walked + hit.t * distance(a, b), point: hit.point };
    walked += distance(a, b);
  }
  return best;
}

export function pathLength(path: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += distance(path[i - 1]!, path[i]!);
  return length;
}

/** Skärningspunkter mellan två linjer, med läget längs den första. */
export function pathIntersections(a: readonly Point[], b: readonly Point[]): { point: Point; along: number }[] {
  const out: { point: Point; along: number }[] = [];
  let walked = 0;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1]!;
    const r = { x: a[i]!.x - p.x, y: a[i]!.y - p.y };
    for (let j = 1; j < b.length; j++) {
      const q = b[j - 1]!;
      const s = { x: b[j]!.x - q.x, y: b[j]!.y - q.y };
      const denominator = r.x * s.y - r.y * s.x;
      if (Math.abs(denominator) < 1e-12) continue;
      const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / denominator;
      const u = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / denominator;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push({ point: { x: p.x + t * r.x, y: p.y + t * r.y }, along: walked + t * Math.hypot(r.x, r.y) });
    }
    walked += Math.hypot(r.x, r.y);
  }
  return out;
}

/** Delen av linjen mellan två längder (mm från början). */
export function subPath(path: readonly Point[], from: number, to: number): Point[] {
  const out: Point[] = [];
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const length = distance(a, b);
    const start = walked;
    const end = walked + length;
    if (end >= from && start <= to && length > 0) {
      if (out.length === 0) out.push(alongLine(a, b, Math.max(0, from - start)));
      if (end <= to) out.push(b);
      else { out.push(alongLine(a, b, to - start)); break; }
    }
    walked = end;
  }
  return out;
}

/** Linjen utan avbrotten (läge och längd i mm från början); delar kortare än 0,01 mm tas bort. */
export function cutPath(path: readonly Point[], gaps: readonly { start: number; length: number }[]): Point[][] {
  const total = pathLength(path);
  const sorted = [...gaps].filter(g => g.length > 0).sort((a, b) => a.start - b.start);
  const pieces: Point[][] = [];
  let position = 0;
  for (const gap of sorted) {
    if (gap.start > position) pieces.push(subPath(path, position, Math.min(gap.start, total)));
    position = Math.max(position, gap.start + gap.length);
  }
  if (position < total) pieces.push(subPath(path, position, total));
  return pieces.filter(piece => piece.length >= 2 && pathLength(piece) > 0.01);
}

/** Kubisk Bézierkurva som linje. */
export function bezier(p0: Point, p1: Point, p2: Point, p3: Point, steps = 8): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
    });
  }
  return out;
}

/** Vrid och flytta en punkt (grader moturs). */
export function place(local: Point, center: Point, degrees: number, scale = 1): Point {
  const a = degrees * Math.PI / 180;
  return {
    x: center.x + scale * (local.x * Math.cos(a) - local.y * Math.sin(a)),
    y: center.y + scale * (local.x * Math.sin(a) + local.y * Math.cos(a))
  };
}

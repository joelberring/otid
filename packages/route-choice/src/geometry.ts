/** Steg 60: små geometrifunktioner i kartans mm. */
import type { Point } from "@o-tid/map-file";

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Avståndet från punkten till sträckan a–b. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distance(points[index - 1]!, points[index]!);
  return total;
}

/** Douglas–Peucker: punkter som avviker mindre än `tolerance` från den förenklade linjen tas bort. */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1, worstIndex = -1;
    for (let index = first + 1; index < last; index += 1) {
      const d = distanceToSegment(points[index]!, points[first]!, points[last]!);
      if (d > worst) { worst = d; worstIndex = index; }
    }
    if (worst > tolerance && worstIndex > 0) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

/** Kortaste avståndet från punkten till polylinjen. */
export function distanceToPolyline(p: Point, points: readonly Point[]): number {
  if (points.length === 1) return distance(p, points[0]!);
  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) best = Math.min(best, distanceToSegment(p, points[index - 1]!, points[index]!));
  return best;
}

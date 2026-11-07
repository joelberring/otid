/** Plangeometri i kartans mm: avstånd, närmaste punkt på en sträcka och linjens längd. Delas av banläggningen och vägvalen. */
import type { Point } from "./model";

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Läget (0–1) längs sträckan a–b för punkten närmast p. */
function segmentT(p: Point, a: Point, dx: number, dy: number): number {
  const lengthSquared = dx * dx + dy * dy;
  return lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
}

/** Närmaste punkt på sträckan a–b, avståndet dit och läget längs sträckan (0–1). */
export function nearestOnSegment(p: Point, a: Point, b: Point): { point: Point; distance: number; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = segmentT(p, a, dx, dy);
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, distance: distance(p, point), t };
}

/** Avståndet från punkten till sträckan a–b (utan att skapa några objekt; körs i vägvalens inre loopar). */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = segmentT(p, a, dx, dy);
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

/** Linjens längd. */
export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distance(points[index - 1]!, points[index]!);
  return total;
}

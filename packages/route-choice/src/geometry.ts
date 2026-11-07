/** Steg 60: förenkling av linjer och avstånd till en linje, i kartans mm. */
import { distance, distanceToSegment, type Point } from "@o-tid/map-file";

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

export type PublicRoutePlaybackPoint = Readonly<{ x: number; y: number; segment: number }>;

export type PublicRoutePlaybackMarker = Readonly<{ x: number; y: number }>;

/**
 * Locates a recorded position using only pixel coordinates and relative GPX
 * time. The caller controls whether that pixel series is public or private.
 * A GPX segment boundary is a true discontinuity: never animate a made-up
 * line from one segment to the next.
 */
export function publicRoutePlaybackMarker(
  points: readonly PublicRoutePlaybackPoint[],
  pointElapsedMilliseconds: readonly number[],
  elapsedMilliseconds: number
): PublicRoutePlaybackMarker | null {
  if (points.length < 2 || points.length !== pointElapsedMilliseconds.length || !Number.isFinite(elapsedMilliseconds)) return null;
  if (pointElapsedMilliseconds.some((time, index, all) => !Number.isSafeInteger(time) || time < 0 || (index > 0 && time < (all[index - 1] ?? 0)))) return null;
  const elapsed = Math.max(0, elapsedMilliseconds);
  let lower = 0;
  let upper = pointElapsedMilliseconds.length - 1;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if ((pointElapsedMilliseconds[middle] ?? 0) <= elapsed) lower = middle;
    else upper = middle - 1;
  }
  const previousIndex = lower;
  const previous = points[previousIndex];
  if (!previous || (pointElapsedMilliseconds[previousIndex] ?? 0) === elapsed || previousIndex === points.length - 1) return previous ? { x: previous.x, y: previous.y } : null;
  const next = points[previousIndex + 1];
  const previousTime = pointElapsedMilliseconds[previousIndex];
  const nextTime = pointElapsedMilliseconds[previousIndex + 1];
  if (!next || previousTime === undefined || nextTime === undefined || previous.segment !== next.segment || nextTime <= previousTime) return null;
  const progress = (elapsed - previousTime) / (nextTime - previousTime);
  return { x: previous.x + (next.x - previous.x) * progress, y: previous.y + (next.y - previous.y) * progress };
}

import { PRIVATE_ROUTE_START_OFFSET_LIMIT_SECONDS } from "./private-route-start-alignment";

export type PrivateRouteControlTimeTarget =
  | { status: "IN_RANGE"; elapsedMilliseconds: number }
  | { status: "OUT_OF_RANGE"; elapsedMilliseconds: number };

/** Maps one published accumulated control time onto the unchanged GPX timeline. */
export function privateRouteControlTimeTarget(input: {
  gpxStartedAt: string;
  resultStartedAt: string;
  offsetSeconds: number;
  splitElapsedMilliseconds: number;
  durationMilliseconds: number;
}): PrivateRouteControlTimeTarget | null {
  const { gpxStartedAt, resultStartedAt, offsetSeconds, splitElapsedMilliseconds, durationMilliseconds } = input;
  if (!Number.isSafeInteger(offsetSeconds) || Math.abs(offsetSeconds) > PRIVATE_ROUTE_START_OFFSET_LIMIT_SECONDS) return null;
  if (!Number.isSafeInteger(splitElapsedMilliseconds) || splitElapsedMilliseconds < 0) return null;
  if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds < 0) return null;

  const gpxStart = Date.parse(gpxStartedAt);
  const resultStart = Date.parse(resultStartedAt);
  if (!Number.isFinite(gpxStart) || !Number.isFinite(resultStart)) return null;

  const elapsedMilliseconds = resultStart - (gpxStart + offsetSeconds * 1_000) + splitElapsedMilliseconds;
  if (!Number.isSafeInteger(elapsedMilliseconds)) return null;
  return elapsedMilliseconds >= 0 && elapsedMilliseconds <= durationMilliseconds
    ? { status: "IN_RANGE", elapsedMilliseconds }
    : { status: "OUT_OF_RANGE", elapsedMilliseconds };
}

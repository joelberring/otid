export const PRIVATE_ROUTE_START_OFFSET_LIMIT_SECONDS = 86_400;

export type PrivateRouteStartAlignment =
  | { status: "IN_RANGE"; elapsedMilliseconds: number }
  | { status: "OUT_OF_RANGE"; elapsedMilliseconds: number };

/** Maps a result start onto the unchanged elapsed timeline of an absolute-time GPX. */
export function privateRouteStartAlignment(input: {
  gpxStartedAt: string;
  resultStartedAt: string;
  offsetSeconds: number;
  durationMilliseconds: number;
}): PrivateRouteStartAlignment | null {
  const { gpxStartedAt, resultStartedAt, offsetSeconds, durationMilliseconds } = input;
  if (!Number.isSafeInteger(offsetSeconds) || Math.abs(offsetSeconds) > PRIVATE_ROUTE_START_OFFSET_LIMIT_SECONDS) return null;
  if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds < 0) return null;

  const gpxStart = Date.parse(gpxStartedAt);
  const resultStart = Date.parse(resultStartedAt);
  if (!Number.isFinite(gpxStart) || !Number.isFinite(resultStart)) return null;

  const elapsedMilliseconds = resultStart - (gpxStart + offsetSeconds * 1_000);
  if (!Number.isSafeInteger(elapsedMilliseconds)) return null;
  return elapsedMilliseconds >= 0 && elapsedMilliseconds <= durationMilliseconds
    ? { status: "IN_RANGE", elapsedMilliseconds }
    : { status: "OUT_OF_RANGE", elapsedMilliseconds };
}

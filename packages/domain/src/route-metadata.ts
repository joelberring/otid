/**
 * Derived facts about one recorded GPX track. This deliberately operates on
 * private source coordinates; callers decide which derived facts may publish.
 */
export type RouteMetadataPoint = Readonly<{
  segment: number;
  latitude: number;
  longitude: number;
  recordedAt: Date | null;
}>;

export type RouteTiming =
  | Readonly<{ status: "AVAILABLE"; startedAt: Date; finishedAt: Date; durationMilliseconds: number }>
  | Readonly<{ status: "UNAVAILABLE" }>;

export type RouteMetadata = Readonly<{
  distanceMeters: number;
  pointCount: number;
  segmentCount: number;
  timing: RouteTiming;
}>;

export class RouteMetadataError extends Error {
  constructor(readonly code: "INVALID_POINT") { super(code); }
}

const earthRadiusMeters = 6_371_000;

function isCoordinate(point: RouteMetadataPoint): boolean {
  return Number.isSafeInteger(point.segment) && point.segment >= 0 &&
    Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90 &&
    Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180;
}

function metersBetween(first: RouteMetadataPoint, second: RouteMetadataPoint): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (second.latitude - first.latitude) * radians;
  const longitudeDelta = (second.longitude - first.longitude) * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(first.latitude * radians) *
    Math.cos(second.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function timingFor(points: readonly RouteMetadataPoint[]): RouteTiming {
  let previous: Date | null = null;
  for (const point of points) {
    if (point.recordedAt === null || !Number.isFinite(point.recordedAt.getTime())) return { status: "UNAVAILABLE" };
    // A complete track has one chronological source sequence. This includes
    // monotonicity within every GPX segment and avoids a negative duration.
    if (previous !== null && point.recordedAt.getTime() < previous.getTime()) return { status: "UNAVAILABLE" };
    previous = point.recordedAt;
  }
  const startedAt = points[0]?.recordedAt;
  const finishedAt = points.at(-1)?.recordedAt;
  if (startedAt === null || finishedAt === null || startedAt === undefined || finishedAt === undefined) return { status: "UNAVAILABLE" };
  return { status: "AVAILABLE", startedAt: new Date(startedAt.getTime()), finishedAt: new Date(finishedAt.getTime()), durationMilliseconds: finishedAt.getTime() - startedAt.getTime() };
}

/** Sums only adjacent points in the same GPX segment; no artificial bridge is created. */
export function deriveRouteMetadata(points: readonly RouteMetadataPoint[]): RouteMetadata {
  if (points.length < 2 || points.some(point => !isCoordinate(point))) throw new RouteMetadataError("INVALID_POINT");
  let distanceMeters = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous !== undefined && current !== undefined && previous.segment === current.segment) distanceMeters += metersBetween(previous, current);
  }
  return { distanceMeters, pointCount: points.length, segmentCount: new Set(points.map(point => point.segment)).size, timing: timingFor(points) };
}

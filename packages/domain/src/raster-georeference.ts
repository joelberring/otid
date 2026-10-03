/** A deliberately narrow, pure pixel-to-WGS84 affine calibration. */
export type RasterTiePoint = Readonly<{
  pixelX: number;
  pixelY: number;
  longitude: number;
  latitude: number;
}>;

export type RasterAffineTransform = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}>;

export type RasterGeoreference = Readonly<{
  imageWidth: number;
  imageHeight: number;
  tiePoints: readonly [RasterTiePoint, RasterTiePoint, RasterTiePoint];
  transform: RasterAffineTransform;
  /** Numerical fit only; three points do not establish field accuracy. */
  maxResidualMeters: number;
}>;

export class RasterGeoreferenceError extends Error {
  constructor(readonly code: "INVALID_DIMENSIONS" | "INVALID_POINT" | "COLLINEAR_POINTS" | "NON_INVERTIBLE_TRANSFORM" | "NUMERICAL_RESIDUAL") {
    super(code);
  }
}

function finite(value: number): boolean { return Number.isFinite(value); }

function determinant(points: readonly RasterTiePoint[], x: (point: RasterTiePoint) => number, y: (point: RasterTiePoint) => number): number {
  const [first, second, third] = points;
  if (!first || !second || !third) throw new RasterGeoreferenceError("COLLINEAR_POINTS");
  return x(first) * (y(second) - y(third)) + x(second) * (y(third) - y(first)) + x(third) * (y(first) - y(second));
}

function determinantTolerance(points: readonly RasterTiePoint[], x: (point: RasterTiePoint) => number, y: (point: RasterTiePoint) => number): number {
  const scale = Math.max(1, ...points.flatMap(point => [Math.abs(x(point)), Math.abs(y(point))]));
  return Number.EPSILON * scale * scale * 128;
}

function solve(points: readonly RasterTiePoint[], value: (point: RasterTiePoint) => number, determinantValue: number): readonly [number, number, number] {
  const [first, second, third] = points;
  if (!first || !second || !third) throw new RasterGeoreferenceError("COLLINEAR_POINTS");
  const coefficientX = (value(first) * (second.pixelY - third.pixelY) + value(second) * (third.pixelY - first.pixelY) + value(third) * (first.pixelY - second.pixelY)) / determinantValue;
  const coefficientY = (first.pixelX * (value(second) - value(third)) + second.pixelX * (value(third) - value(first)) + third.pixelX * (value(first) - value(second))) / determinantValue;
  const constant = (first.pixelX * (second.pixelY * value(third) - third.pixelY * value(second)) + second.pixelX * (third.pixelY * value(first) - first.pixelY * value(third)) + third.pixelX * (first.pixelY * value(second) - second.pixelY * value(first))) / determinantValue;
  return [coefficientX, coefficientY, constant];
}

function metersBetween(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (latitudeB - latitudeA) * radians;
  const longitudeDelta = (longitudeB - longitudeA) * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA * radians) * Math.cos(latitudeB * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function projectRasterPixel(transform: RasterAffineTransform, pixelX: number, pixelY: number): Readonly<{ longitude: number; latitude: number }> {
  return { longitude: transform.a * pixelX + transform.b * pixelY + transform.c, latitude: transform.d * pixelX + transform.e * pixelY + transform.f };
}

export function invertRasterCoordinate(transform: RasterAffineTransform, longitude: number, latitude: number): Readonly<{ pixelX: number; pixelY: number }> {
  const determinantValue = transform.a * transform.e - transform.b * transform.d;
  if (!finite(determinantValue) || Math.abs(determinantValue) <= Number.EPSILON * 128) throw new RasterGeoreferenceError("NON_INVERTIBLE_TRANSFORM");
  const adjustedLongitude = longitude - transform.c;
  const adjustedLatitude = latitude - transform.f;
  return { pixelX: (transform.e * adjustedLongitude - transform.b * adjustedLatitude) / determinantValue, pixelY: (-transform.d * adjustedLongitude + transform.a * adjustedLatitude) / determinantValue };
}

export function deriveRasterGeoreference(input: Readonly<{ imageWidth: number; imageHeight: number; tiePoints: readonly [RasterTiePoint, RasterTiePoint, RasterTiePoint] }>): RasterGeoreference {
  if (!Number.isSafeInteger(input.imageWidth) || !Number.isSafeInteger(input.imageHeight) || input.imageWidth < 1 || input.imageHeight < 1) throw new RasterGeoreferenceError("INVALID_DIMENSIONS");
  const points = input.tiePoints;
  for (const point of points) {
    if (!finite(point.pixelX) || !finite(point.pixelY) || !finite(point.longitude) || !finite(point.latitude) ||
      point.pixelX < 0 || point.pixelX >= input.imageWidth || point.pixelY < 0 || point.pixelY >= input.imageHeight ||
      point.longitude < -180 || point.longitude > 180 || point.latitude < -90 || point.latitude > 90) throw new RasterGeoreferenceError("INVALID_POINT");
  }
  const pixelDeterminant = determinant(points, point => point.pixelX, point => point.pixelY);
  const targetDeterminant = determinant(points, point => point.longitude, point => point.latitude);
  if (!finite(pixelDeterminant) || !finite(targetDeterminant) || Math.abs(pixelDeterminant) <= determinantTolerance(points, point => point.pixelX, point => point.pixelY) || Math.abs(targetDeterminant) <= determinantTolerance(points, point => point.longitude, point => point.latitude)) throw new RasterGeoreferenceError("COLLINEAR_POINTS");
  const [a, b, c] = solve(points, point => point.longitude, pixelDeterminant);
  const [d, e, f] = solve(points, point => point.latitude, pixelDeterminant);
  const transform = { a, b, c, d, e, f };
  const transformDeterminant = a * e - b * d;
  if (Object.values(transform).some(value => !finite(value)) || !finite(transformDeterminant) || Math.abs(transformDeterminant) <= Number.EPSILON * 128) throw new RasterGeoreferenceError("NON_INVERTIBLE_TRANSFORM");
  const maxResidualMeters = Math.max(...points.map(point => {
    const projected = projectRasterPixel(transform, point.pixelX, point.pixelY);
    return metersBetween(point.latitude, point.longitude, projected.latitude, projected.longitude);
  }));
  if (!finite(maxResidualMeters) || maxResidualMeters > 0.01) throw new RasterGeoreferenceError("NUMERICAL_RESIDUAL");
  return { imageWidth: input.imageWidth, imageHeight: input.imageHeight, tiePoints: points, transform, maxResidualMeters };
}

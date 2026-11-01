import { wgs84ToMapPoint, type MapGeoreference, type Point } from "@o-tid/map-file";

/**
 * Fältläget, första versionen (ADR-0181 beslut 6–7): telefonens position (WGS 84) på kartan i kartans mm (y uppåt) med
 * kartfilens georeferens, medelvärdet av flera positioner och steg i meter i terrängen. Ren TypeScript utan webbläsare.
 */

/** En position från `navigator.geolocation` (grader, noggrannheten i meter). */
export interface PositionFix {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number;
}

/** Positionen på kartan: punkten i mm och noggrannheten både i meter och i mm på kartan. */
export interface MapPosition {
  readonly at: Point;
  readonly accuracyM: number;
  readonly accuracyMm: number;
}

/** Meter i terrängen per mm på kartan. Med georeferens dess skala (och Mappers hjälpskalfaktor), annars kartans skala. */
export function metersPerMm(georeference: MapGeoreference | null | undefined, mapScale: number): number {
  return georeference ? (georeference.scale / 1000) * georeference.combinedScaleFactor : mapScale / 1000;
}

/** WGS 84 → kartans mm. Kastar om kartans koordinatsystem inte stöds (`wgs84ToMapPoint`). */
export function toMapPosition(georeference: MapGeoreference, fix: PositionFix): MapPosition {
  const at = wgs84ToMapPoint(georeference, { latitude: fix.latitude, longitude: fix.longitude });
  return { at, accuracyM: fix.accuracyM, accuracyMm: fix.accuracyM / metersPerMm(georeference, georeference.scale) };
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

export interface AveragedPosition {
  readonly at: Point;
  /** Medelvärdet av de använda positionernas noggrannhet i meter. */
  readonly accuracyM: number;
  readonly used: number;
  readonly discarded: number;
}

/**
 * Medelvärdet av positionerna. Avvikare kastas: en position längre från medianpunkten än 2 × medianavståndet räknas
 * inte. Tom lista ger `undefined`.
 */
export function averagePositions(samples: readonly MapPosition[]): AveragedPosition | undefined {
  if (samples.length === 0) return undefined;
  const center = { x: median(samples.map(sample => sample.at.x)), y: median(samples.map(sample => sample.at.y)) };
  const distances = samples.map(sample => Math.hypot(sample.at.x - center.x, sample.at.y - center.y));
  const limit = 2 * median(distances);
  const kept = samples.filter((_sample, index) => distances[index]! <= limit);
  const sum = kept.reduce((total, sample) => ({ x: total.x + sample.at.x, y: total.y + sample.at.y, accuracy: total.accuracy + sample.accuracyM }),
    { x: 0, y: 0, accuracy: 0 });
  return { at: { x: sum.x / kept.length, y: sum.y / kept.length }, accuracyM: sum.accuracy / kept.length, used: kept.length,
    discarded: samples.length - kept.length };
}

export type StepDirection = "N" | "S" | "E" | "W";

/**
 * Punkten flyttad `meters` meter i terrängen åt ett väderstreck. Norr är kartans uppåt (y växer uppåt). Den magnetiska
 * vridningen (och grivationen) tas inte med: på en orienteringskarta är uppåt magnetisk nord, och finjusteringen är
 * till för att följa kartbilden.
 */
export function stepPoint(at: Point, direction: StepDirection, meters: number, metersPerMapMm: number): Point {
  const mm = meters / metersPerMapMm;
  switch (direction) {
    case "N": return { x: at.x, y: at.y + mm };
    case "S": return { x: at.x, y: at.y - mm };
    case "E": return { x: at.x + mm, y: at.y };
    case "W": return { x: at.x - mm, y: at.y };
  }
}

/** Ligger punkten på kartan (med marginal i mm)? Skyddar mot en georeferens eller position som är helt fel. */
export function insideBounds(at: Point, bounds: { minX: number; minY: number; maxX: number; maxY: number }, marginMm = 50): boolean {
  return at.x >= bounds.minX - marginMm && at.x <= bounds.maxX + marginMm && at.y >= bounds.minY - marginMm && at.y <= bounds.maxY + marginMm;
}

/** Det `deviceorientation` ger: iOS `webkitCompassHeading` (grader medurs från norr), annars `alpha` (moturs) när den är absolut. */
export interface OrientationReading {
  readonly webkitCompassHeading?: number | undefined;
  readonly absolute?: boolean | undefined;
  readonly alpha?: number | null | undefined;
}

/**
 * Steg 67: kompassriktningen i grader medurs från norr (kartans uppåt), avrundad till 5°, eller undefined om telefonen inte
 * ger någon. `screenAngle` är skärmens vridning (liggande telefon). Kompassen ger magnetisk nord, som orienteringskartan.
 */
export function compassHeading(reading: OrientationReading, screenAngle = 0): number | undefined {
  let heading: number | undefined;
  const ios = reading.webkitCompassHeading;
  if (typeof ios === "number" && Number.isFinite(ios) && ios >= 0) heading = ios;
  else if (reading.absolute && typeof reading.alpha === "number" && Number.isFinite(reading.alpha)) heading = 360 - reading.alpha;
  if (heading === undefined) return undefined;
  const rounded = Math.round((heading + screenAngle) / 5) * 5;
  return ((rounded % 360) + 360) % 360;
}

/** Noggrannheten är sämre än så här (meter): positionen visas med en varning. */
export const POOR_ACCURACY_M = 15;

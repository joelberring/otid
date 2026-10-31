/**
 * Steg 59 (ADR-0179 beslut 4): kartans mm ↔ projicerade meter ↔ WGS 84.
 *
 * Gauss–Krüger (transversal Mercator) på GRS 80 enligt Lantmäteriets formelsamling ("Gauss konforma projektion",
 * Krügers serier till fjärde ordningen). Skillnaden mellan SWEREF 99 och WGS 84 (under en meter) försummas, som i
 * resten av O-Tid. RT 90 2,5 gon V räknas med Lantmäteriets direkta projektionsparametrar för GRS 80, alltså direkt
 * från SWEREF 99-latitud och -longitud utan datumbyte.
 */
import type { MapCrs, MapGeoreference, Point } from "./model";

export interface ProjectedPoint { readonly easting: number; readonly northing: number }
export interface Wgs84Point { readonly latitude: number; readonly longitude: number }

/** Parametrar för en transversal Mercator-projektion. Vinklar i grader, längder i meter. */
export interface TransverseMercator {
  readonly centralMeridian: number;
  readonly scaleFactor: number;
  readonly falseNorthing: number;
  readonly falseEasting: number;
}

const GRS80_A = 6378137;
const GRS80_F = 1 / 298.257222101;

const SWEREF99_LOCAL_MERIDIANS: Readonly<Record<number, number>> = {
  3007: 12, 3008: 13.5, 3009: 15, 3010: 16.5, 3011: 18, 3012: 14.25,
  3013: 15.75, 3014: 17.25, 3015: 18.75, 3016: 20.25, 3017: 21.75, 3018: 23.25
};

/** Projektionen för ett EPSG-nummer som O-Tid kan räkna, annars null. */
export function transverseMercatorFor(epsg: number): TransverseMercator | null {
  if (epsg === 3006) return { centralMeridian: 15, scaleFactor: 0.9996, falseNorthing: 0, falseEasting: 500000 };
  const local = SWEREF99_LOCAL_MERIDIANS[epsg];
  if (local !== undefined) return { centralMeridian: local, scaleFactor: 1, falseNorthing: 0, falseEasting: 150000 };
  if (epsg === 3021) {
    return {
      centralMeridian: 15 + 48 / 60 + 22.624306 / 3600,
      scaleFactor: 1.00000561024,
      falseNorthing: -667.711,
      falseEasting: 1500064.274
    };
  }
  return null;
}

export function isSupportedEpsg(epsg: number): boolean {
  return transverseMercatorFor(epsg) !== null;
}

/** Kartfilens koordinatsystem som `MapCrs`: EPSG bara när O-Tid kan räkna det, annars UNKNOWN med beskrivning. */
export function crsFromEpsg(epsg: number | null, description: string): MapCrs {
  if (epsg !== null && isSupportedEpsg(epsg)) return { kind: "EPSG", code: epsg };
  return { kind: "UNKNOWN", description };
}

// Konstanter som bara beror på ellipsoiden, räknade en gång.
const E2 = GRS80_F * (2 - GRS80_F);
const N = GRS80_F / (2 - GRS80_F);
const A_HAT = (GRS80_A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);

// Geodetisk latitud → konform latitud (framåt).
const FWD_A = E2;
const FWD_B = (5 * E2 ** 2 - E2 ** 3) / 6;
const FWD_C = (104 * E2 ** 3 - 45 * E2 ** 4) / 120;
const FWD_D = (1237 * E2 ** 4) / 1260;

// Konform latitud → geodetisk latitud (bakåt). Inte samma konstanter som framåt.
const INV_A = E2 + E2 ** 2 + E2 ** 3 + E2 ** 4;
const INV_B = -(7 * E2 ** 2 + 17 * E2 ** 3 + 30 * E2 ** 4) / 6;
const INV_C = (224 * E2 ** 3 + 889 * E2 ** 4) / 120;
const INV_D = -(4279 * E2 ** 4) / 1260;

const BETA = [
  N / 2 - (2 * N ** 2) / 3 + (5 * N ** 3) / 16 + (41 * N ** 4) / 180,
  (13 * N ** 2) / 48 - (3 * N ** 3) / 5 + (557 * N ** 4) / 1440,
  (61 * N ** 3) / 240 - (103 * N ** 4) / 140,
  (49561 * N ** 4) / 161280
] as const;

const DELTA = [
  N / 2 - (2 * N ** 2) / 3 + (37 * N ** 3) / 96 - N ** 4 / 360,
  N ** 2 / 48 + N ** 3 / 15 - (437 * N ** 4) / 1440,
  (17 * N ** 3) / 480 - (37 * N ** 4) / 840,
  (4397 * N ** 4) / 161280
] as const;

const RAD = Math.PI / 180;

/** Latitud och longitud (grader) → projicerade meter (E, N). */
export function geodeticToGrid(projection: TransverseMercator, latitude: number, longitude: number): ProjectedPoint {
  const phi = latitude * RAD;
  const dLambda = (longitude - projection.centralMeridian) * RAD;
  const s = Math.sin(phi);
  const s2 = s * s;
  const phiStar = phi - s * Math.cos(phi) * (FWD_A + s2 * (FWD_B + s2 * (FWD_C + s2 * FWD_D)));
  const xiPrime = Math.atan2(Math.tan(phiStar), Math.cos(dLambda));
  const etaPrime = Math.atanh(Math.cos(phiStar) * Math.sin(dLambda));
  let xi = xiPrime;
  let eta = etaPrime;
  for (let j = 0; j < 4; j++) {
    const k = 2 * (j + 1);
    xi += BETA[j]! * Math.sin(k * xiPrime) * Math.cosh(k * etaPrime);
    eta += BETA[j]! * Math.cos(k * xiPrime) * Math.sinh(k * etaPrime);
  }
  const scale = projection.scaleFactor * A_HAT;
  return { northing: scale * xi + projection.falseNorthing, easting: scale * eta + projection.falseEasting };
}

/** Projicerade meter (E, N) → latitud och longitud (grader). */
export function gridToGeodetic(projection: TransverseMercator, easting: number, northing: number): Wgs84Point {
  const scale = projection.scaleFactor * A_HAT;
  const xi = (northing - projection.falseNorthing) / scale;
  const eta = (easting - projection.falseEasting) / scale;
  let xiPrime = xi;
  let etaPrime = eta;
  for (let j = 0; j < 4; j++) {
    const k = 2 * (j + 1);
    xiPrime -= DELTA[j]! * Math.sin(k * xi) * Math.cosh(k * eta);
    etaPrime -= DELTA[j]! * Math.cos(k * xi) * Math.sinh(k * eta);
  }
  const phiStar = Math.asin(Math.sin(xiPrime) / Math.cosh(etaPrime));
  const dLambda = Math.atan2(Math.sinh(etaPrime), Math.cos(xiPrime));
  const s = Math.sin(phiStar);
  const s2 = s * s;
  const phi = phiStar + s * Math.cos(phiStar) * (INV_A + s2 * (INV_B + s2 * (INV_C + s2 * INV_D)));
  return { latitude: phi / RAD, longitude: projection.centralMeridian + dLambda / RAD };
}

function projectionOf(crs: MapCrs): TransverseMercator {
  if (crs.kind === "UNKNOWN") {
    throw new Error(`Kartans koordinatsystem (${crs.description}) stöds inte. Georeferera kartan med tre punkter.`);
  }
  const projection = transverseMercatorFor(crs.code);
  if (!projection) throw new Error(`Koordinatsystemet EPSG:${crs.code} stöds inte. Georeferera kartan med tre punkter.`);
  return projection;
}

export function projectedToWgs84(crs: MapCrs, easting: number, northing: number): Wgs84Point {
  return gridToGeodetic(projectionOf(crs), easting, northing);
}

export function wgs84ToProjected(crs: MapCrs, latitude: number, longitude: number): ProjectedPoint {
  return geodeticToGrid(projectionOf(crs), latitude, longitude);
}

function mapScale(georef: MapGeoreference): number {
  return (georef.scale / 1000) * georef.combinedScaleFactor;
}

/** Kartans mm (y uppåt) → projicerade meter. Grivationen är medurs (formeln i `MapGeoreference`). */
export function mapPointToProjected(georef: MapGeoreference, point: Point): ProjectedPoint {
  const g = georef.grivationDegrees * RAD;
  const cos = Math.cos(g);
  const sin = Math.sin(g);
  const s = mapScale(georef);
  const x = point.x - georef.mapRefPoint.x;
  const y = point.y - georef.mapRefPoint.y;
  return {
    easting: georef.refPoint.easting + s * (x * cos + y * sin),
    northing: georef.refPoint.northing + s * (-x * sin + y * cos)
  };
}

export function projectedToMapPoint(georef: MapGeoreference, projected: ProjectedPoint): Point {
  const g = georef.grivationDegrees * RAD;
  const cos = Math.cos(g);
  const sin = Math.sin(g);
  const s = mapScale(georef);
  const dE = (projected.easting - georef.refPoint.easting) / s;
  const dN = (projected.northing - georef.refPoint.northing) / s;
  return { x: georef.mapRefPoint.x + dE * cos - dN * sin, y: georef.mapRefPoint.y + dE * sin + dN * cos };
}

export function mapPointToWgs84(georef: MapGeoreference, point: Point): Wgs84Point {
  const projected = mapPointToProjected(georef, point);
  return projectedToWgs84(georef.crs, projected.easting, projected.northing);
}

export function wgs84ToMapPoint(georef: MapGeoreference, position: Wgs84Point): Point {
  return projectedToMapPoint(georef, wgs84ToProjected(georef.crs, position.latitude, position.longitude));
}

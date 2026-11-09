import { geodeticToGrid, gridToGeodetic, transverseMercatorFor } from "./georef";
import type { MapGeoreference } from "./model";
import { decimalYear, magneticDeclination, type Declination } from "./wmm";

/**
 * ADR-0223: kartans nordriktning jämförd med dagens magnetiska nord. Kartans missvisning är grivationen plus
 * meridiankonvergensen i referenspunkten (grivation = missvisning − konvergens, som när kartan skapas), och dagens kommer ur
 * World Magnetic Model. Skillnaden är hur mycket kartan behöver vridas för att nordlinjerna ska peka mot magnetisk nord i dag.
 */
export interface MapNorthFacts {
  /** Missvisningen kartan är ritad för (grader, östlig positiv). */
  readonly mapDeclination: number;
  /** Missvisningen i referenspunkten vid datumet enligt WMM. */
  readonly magnetic: Declination;
  /** Magnetisk i dag minus kartans (grader). */
  readonly difference: number;
}

export function mapNorthFacts(georef: MapGeoreference, date: string | Date): MapNorthFacts | null {
  if (georef.crs.kind !== "EPSG") return null;
  const projection = transverseMercatorFor(georef.crs.code);
  if (!projection) return null;
  const here = gridToGeodetic(projection, georef.refPoint.easting, georef.refPoint.northing);
  // Konvergensen: sann nords riktning i nätet, medurs från nätets y-axel (som `gridConvergenceDegrees`).
  const north = geodeticToGrid(projection, here.latitude + 0.001, here.longitude);
  const convergence = -Math.atan2(north.easting - georef.refPoint.easting, north.northing - georef.refPoint.northing) * 180 / Math.PI;
  const mapDeclination = georef.grivationDegrees + convergence;
  const magnetic = magneticDeclination(here.latitude, here.longitude, decimalYear(date));
  return { mapDeclination, magnetic, difference: magnetic.degrees - mapDeclination };
}

/** Missvisningen för en punkt i WGS 84 ett datum, avrundad till en tiondels grad (förvalet för en ny karta). */
export function declinationAt(latitude: number, longitude: number, date: string | Date): number {
  return Math.round(magneticDeclination(latitude, longitude, decimalYear(date)).degrees * 10) / 10;
}

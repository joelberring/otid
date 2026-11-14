import { geodeticToGrid, gridToGeodetic, transverseMercatorFor } from "./georef";
import type { MapGeoreference, ParsedMap } from "./model";
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
  /** Meridiankonvergensen i referenspunkten: sann nords riktning i nätet (grader medurs från nätets norr är −konvergensen). */
  readonly convergence: number;
}

/**
 * `northLines` = nordlinjernas riktning i kartan (`northLineDegrees`), när kartan har sådana: då gäller linjerna i stället för
 * filens vinkel, eftersom det är dem löparen orienterar efter.
 */
export function mapNorthFacts(georef: MapGeoreference, date: string | Date, northLines?: number): MapNorthFacts | null {
  if (georef.crs.kind !== "EPSG") return null;
  const projection = transverseMercatorFor(georef.crs.code);
  if (!projection) return null;
  const here = gridToGeodetic(projection, georef.refPoint.easting, georef.refPoint.northing);
  // Konvergensen: sann nords riktning i nätet, medurs från nätets y-axel (som `gridConvergenceDegrees`).
  const north = geodeticToGrid(projection, here.latitude + 0.001, here.longitude);
  const convergence = -Math.atan2(north.easting - georef.refPoint.easting, north.northing - georef.refPoint.northing) * 180 / Math.PI;
  // Linjerna är ritade i kartan, som själv är vriden `grivationDegrees` mot nätet.
  const mapDeclination = georef.grivationDegrees + (northLines ?? 0) + convergence;
  const magnetic = magneticDeclination(here.latitude, here.longitude, decimalYear(date));
  return { mapDeclination, magnetic, difference: magnetic.degrees - mapDeclination, convergence };
}

/** Missvisningen för en punkt i WGS 84 ett datum, avrundad till en tiondels grad (förvalet för en ny karta). */
export function declinationAt(latitude: number, longitude: number, date: string | Date): number {
  return Math.round(magneticDeclination(latitude, longitude, decimalYear(date)).degrees * 10) / 10;
}

/**
 * Nordlinjernas riktning i kartan (grader medurs från kartans uppåt): medianen av de långa linjerna med symbol 601
 * (magnetiska nordlinjer, ISOM och ISSprOM). Undefined om kartan inte har några. Ägaren 2026-11-10: Högdalens OCAD-fil har
 * vinkeln 0 men nordlinjerna ritade 4,4° snett; det är linjerna som säger vilken missvisning kartan är ritad för.
 */
export function northLineDegrees(map: Pick<ParsedMap, "objects" | "symbols">): number | undefined {
  const angles: number[] = [];
  for (const object of map.objects) {
    if (object.kind !== "line" || map.symbols.get(object.symbol)?.code.main !== 601) continue;
    const first = object.path[0], last = object.path[object.path.length - 1];
    if (!first || !last) continue;
    const dx = last.x - first.x, dy = last.y - first.y;
    // Kortare än 2 cm på kartan räknas inte (en bit av en linje eller en pil).
    if (Math.hypot(dx, dy) < 20) continue;
    let angle = Math.atan2(dx, dy) * 180 / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    angles.push(angle);
  }
  if (angles.length === 0) return undefined;
  angles.sort((a, b) => a - b);
  return Math.round(angles[Math.floor(angles.length / 2)]! * 100) / 100;
}

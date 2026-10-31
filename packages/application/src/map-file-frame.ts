import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { ControlMapFileFrame } from "@o-tid/domain";
import { isSupportedEpsg, mapPointToWgs84 } from "@o-tid/map-file";
import type { DbExecutor } from "./snapshot";

/**
 * Steg 59 (ADR-0179 beslut 5): kartfilen bakom kartbilden som ram för kontrollerna. Kartlägena (IOF MapPosition, mm)
 * placeras direkt i bildens pixlar via `render`; kartfilens georeferens används för kontrollen mot banfilens Position.
 * Undefined när bilden inte är ritad ur en kartfil (eller, med `requireGeoreferenced`, när bilden inte är georefererad).
 * Med ett koordinatsystem som O-Tid inte räknar om kontrolleras bara att kartlägena ligger på kartan.
 */
export async function loadMapFileFrame(tx: DbExecutor, raceId: string, options: { readonly requireGeoreferenced?: boolean } = {})
  : Promise<ControlMapFileFrame | undefined> {
  const [row] = await tx.select({ render: schema.raceMapSources.render, bounds: schema.raceMapSources.bounds,
    scale: schema.raceMapSources.scale, georeference: schema.raceMapSources.georeference, width: schema.raceMaps.width,
    height: schema.raceMaps.height, transform: schema.raceMaps.transform })
    .from(schema.raceMapSources).innerJoin(schema.raceMaps, eq(schema.raceMaps.raceId, schema.raceMapSources.raceId))
    .where(eq(schema.raceMapSources.raceId, raceId));
  if (!row || (options.requireGeoreferenced && !row.transform)) return undefined;
  const georeference = row.georeference;
  const toGeo = georeference && georeference.crs.kind === "EPSG" && isSupportedEpsg(georeference.crs.code)
    ? (paper: { x: number; y: number }) => {
      const geo = mapPointToWgs84(georeference, paper);
      return Number.isFinite(geo.latitude) && Number.isFinite(geo.longitude) ? { latitude: geo.latitude, longitude: geo.longitude } : undefined;
    }
    : undefined;
  return { render: row.render, bounds: row.bounds, scale: row.scale, image: { width: row.width, height: row.height }, toGeo };
}

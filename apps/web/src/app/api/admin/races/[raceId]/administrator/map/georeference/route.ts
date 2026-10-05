import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

/** Georeferens med tre punkter (pixel och WGS84). */
export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) {
  return raceAdministratorRoute(db, request, (await context.params).raceId, { kind: "race-map-georeference" });
}

import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

/**
 * Steg 59: kartfilen (OCAD eller Mapper). POST = kartfilen, bilden ritad i webbläsaren och georeferensen i en uppladdning
 * (multipart, högst 60 MB för kartfilen); GET = originalfilen (bara admin); DELETE = ta bort kartfilen men behåll bilden.
 */
const handle = async (request: Request, context: { params: Promise<{ raceId: string }> }) =>
  raceAdministratorRoute(db, request, (await context.params).raceId, { kind: "race-map-source" });
export const GET = handle;
export const POST = handle;
export const DELETE = handle;

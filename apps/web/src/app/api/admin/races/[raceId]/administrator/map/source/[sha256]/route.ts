import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

/**
 * ADR-0218: kartfilen med sin sha256 i adressen. Samma behörighet som `map/source`; när adressens sha256 är filens får
 * webbläsaren behålla filen (privat, oföränderlig, ETag), så att banläggningen inte hämtar samma karta igen.
 */
export async function GET(request: Request, context: { params: Promise<{ raceId: string; sha256: string }> }) {
  const { raceId, sha256 } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "race-map-source", sha256 });
}

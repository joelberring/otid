import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

/**
 * Ägarens plan 2026-11-13, etapp 1: kartprojektet som banläggningens karta kommer ur (GET): projektets namn, den låsta
 * versionen och hur många ändringar projektet har fått sedan dess. För alla som får läsa banläggningen.
 */
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  return raceAdministratorRoute(db, request, (await context.params).raceId, { kind: "race-map-project" });
}

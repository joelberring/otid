import { db } from "../../../../lib/db";
import { raceRestoreRoute } from "../../../../lib/race-restore-route-handlers";

/** "Återställ tävling från säkerhetskopia" (ADR-0187): skapar en ny tävling ur zip-filen. */
export async function POST(request: Request): Promise<Response> {
  return raceRestoreRoute(db, request);
}

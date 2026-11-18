import { db } from "../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../lib/race-administrator-route-handlers";

/** Tävlingsraden (ADR-0227 tillägg 2026-11-18): rollen, typen och datumet för avläsningens Byt funktion. Funktionär eller administratör. */
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "navigation" });
}

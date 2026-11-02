import { db } from "../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../lib/race-administrator-route-handlers";

/** "Ladda ner säkerhetskopia": allt om tävlingen i en zip som kan återställas som en ny tävling (ADR-0187, docs/export.md). */
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "race-export" });
}

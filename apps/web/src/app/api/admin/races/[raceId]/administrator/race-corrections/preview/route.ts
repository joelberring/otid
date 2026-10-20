import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

/** "Visa vad som händer" för en rättning för hela tävlingen (PLAN.md steg 31). */
export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "race-corrections-preview" });
}

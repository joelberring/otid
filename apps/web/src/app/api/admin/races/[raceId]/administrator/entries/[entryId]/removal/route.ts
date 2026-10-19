import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

/** Ta bort deltagare eller stryk (PLAN.md steg 27). */
export async function POST(request: Request, context: { params: Promise<{ raceId: string; entryId: string }> }) {
  const { raceId, entryId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "entry-removal", entryId });
}

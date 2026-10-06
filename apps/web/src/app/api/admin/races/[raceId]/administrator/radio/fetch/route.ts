import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

/** ADR-0172 beslut 5: "Hämta nu" – en hämtning av radiostämplingar direkt. */
export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "radio-fetch" });
}

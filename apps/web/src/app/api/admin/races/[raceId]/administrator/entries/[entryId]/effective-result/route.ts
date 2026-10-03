import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

export async function GET(request: Request, context: { params: Promise<{ raceId: string; entryId: string }> }) {
  const { raceId, entryId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "effective-result", entryId });
}

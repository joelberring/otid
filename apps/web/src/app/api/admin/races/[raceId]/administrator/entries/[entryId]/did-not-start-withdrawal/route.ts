import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

export async function POST(request: Request, context: { params: Promise<{ raceId: string; entryId: string; }> }) {
  const { raceId, entryId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "did-not-start-withdrawal", entryId });
}

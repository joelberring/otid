import { db } from "../../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../../lib/race-administrator-route-handlers";

export async function GET(request: Request, context: { params: Promise<{ raceId: string; entryId: string; targetClassId: string }> }) {
  const { raceId, entryId, targetClassId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "transfer-start-slot-candidates", entryId, targetClassId });
}

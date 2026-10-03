import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

export async function GET(request: Request, context: { params: Promise<{ raceId: string; targetClassId: string }> }) {
  const { raceId, targetClassId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "registration-start-slot-candidates", targetClassId });
}

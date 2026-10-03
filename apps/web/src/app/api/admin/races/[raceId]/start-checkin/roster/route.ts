import { db } from "../../../../../../../lib/db";
import { startCheckinAdminRosterRoute } from "../../../../../../../lib/start-checkin-admin-route-handlers";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  return startCheckinAdminRosterRoute(db, request, (await params).raceId, "START_CHECKIN");
}


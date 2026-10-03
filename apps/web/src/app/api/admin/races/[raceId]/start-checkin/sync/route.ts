import { db } from "../../../../../../../lib/db";
import { startCheckinAdminSyncRoute } from "../../../../../../../lib/start-checkin-admin-route-handlers";

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  return startCheckinAdminSyncRoute(db, request, (await params).raceId, "START_CHECKIN");
}


import { db } from "../../../../../../../lib/db";
import { startCheckinAdminDeviceRoute } from "../../../../../../../lib/start-checkin-admin-route-handlers";

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  return startCheckinAdminDeviceRoute(db, request, (await params).raceId, "FINISH_FOREST_WATCH");
}


import { db } from "../../../../../../lib/db";
import { startCheckinAdminLoginRoute, startCheckinAdminSessionStatusRoute, startCheckinAdminLogoutRoute } from "../../../../../../lib/start-checkin-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return startCheckinAdminSessionStatusRoute(db, request, (await params).raceId, "START_CHECKIN");
}
export async function POST(request: Request, { params }: Context): Promise<Response> {
  return startCheckinAdminLoginRoute(db, request, (await params).raceId, "START_CHECKIN");
}
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return startCheckinAdminLogoutRoute(db, request, (await params).raceId, "START_CHECKIN");
}


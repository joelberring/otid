import { db } from "../../../../../../lib/db";
import {
  raceOverviewAdminLoginRoute,
  raceOverviewAdminLogoutRoute,
  raceOverviewAdminSessionStatusRoute
} from "../../../../../../lib/race-overview-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return raceOverviewAdminSessionStatusRoute(db, request, raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return raceOverviewAdminLoginRoute(db, request, raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return raceOverviewAdminLogoutRoute(db, request, raceId);
}

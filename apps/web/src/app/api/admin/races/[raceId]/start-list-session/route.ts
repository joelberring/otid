import { db } from "../../../../../../lib/db";
import {
  startListAdminLoginRoute,
  startListAdminLogoutRoute,
  startListAdminSessionStatusRoute
} from "../../../../../../lib/start-list-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return startListAdminSessionStatusRoute(db, request, raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return startListAdminLoginRoute(db, request, raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return startListAdminLogoutRoute(db, request, raceId);
}

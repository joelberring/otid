import { db } from "../../../../../../lib/db";
import {
  entryStartTimeAdminLoginRoute,
  entryStartTimeAdminLogoutRoute,
  entryStartTimeAdminSessionStatusRoute
} from "../../../../../../lib/entry-start-time-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return entryStartTimeAdminSessionStatusRoute(db, request, raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return entryStartTimeAdminLoginRoute(db, request, raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return entryStartTimeAdminLogoutRoute(db, request, raceId);
}

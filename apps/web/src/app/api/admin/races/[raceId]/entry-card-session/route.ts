import { db } from "../../../../../../lib/db";
import {
  entryCardAdminLoginRoute,
  entryCardAdminLogoutRoute,
  entryCardAdminSessionStatusRoute
} from "../../../../../../lib/entry-card-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return entryCardAdminSessionStatusRoute(db, request, raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return entryCardAdminLoginRoute(db, request, raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return entryCardAdminLogoutRoute(db, request, raceId);
}


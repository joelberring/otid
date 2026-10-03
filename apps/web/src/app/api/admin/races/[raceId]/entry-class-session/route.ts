import { db } from "../../../../../../lib/db";
import {
  entryClassAdminLoginRoute,
  entryClassAdminLogoutRoute,
  entryClassAdminSessionStatusRoute
} from "../../../../../../lib/entry-class-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return entryClassAdminSessionStatusRoute(db, request, raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return entryClassAdminLoginRoute(db, request, raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return entryClassAdminLogoutRoute(db, request, raceId);
}

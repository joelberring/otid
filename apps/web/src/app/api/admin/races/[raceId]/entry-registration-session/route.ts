import { db } from "../../../../../../lib/db";
import {
  entryRegistrationAdminLoginRoute,
  entryRegistrationAdminLogoutRoute,
  entryRegistrationAdminSessionStatusRoute
} from "../../../../../../lib/entry-registration-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return entryRegistrationAdminSessionStatusRoute(db, request, raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return entryRegistrationAdminLoginRoute(db, request, raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return entryRegistrationAdminLogoutRoute(db, request, raceId);
}

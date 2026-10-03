import { db } from "../../../../../../../lib/db";
import { entryIdentityAdminSessionStatusRoute, entryIdentityAdminLoginRoute, entryIdentityAdminLogoutRoute } from "../../../../../../../lib/entry-identity-admin-route-handlers";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await params;
  return entryIdentityAdminSessionStatusRoute(db, request, raceId);
}

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await params;
  return entryIdentityAdminLoginRoute(db, request, raceId);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await params;
  return entryIdentityAdminLogoutRoute(db, request, raceId);
}

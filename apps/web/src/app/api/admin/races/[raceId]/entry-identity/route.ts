import { db } from "../../../../../../lib/db";
import { entryIdentityAdminListRoute } from "../../../../../../lib/entry-identity-admin-route-handlers";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await params;
  return entryIdentityAdminListRoute(db, request, raceId);
}

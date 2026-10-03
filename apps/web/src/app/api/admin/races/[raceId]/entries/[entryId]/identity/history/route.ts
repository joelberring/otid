import { db } from "../../../../../../../../../lib/db";
import { entryIdentityAdminHistoryRoute } from "../../../../../../../../../lib/entry-identity-admin-route-handlers";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string; entryId: string }> }): Promise<Response> {
  const { raceId, entryId } = await params;
  return entryIdentityAdminHistoryRoute(db, request, raceId, entryId);
}

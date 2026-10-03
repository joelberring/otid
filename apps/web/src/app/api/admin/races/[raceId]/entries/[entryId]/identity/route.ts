import { db } from "../../../../../../../../lib/db";
import { authenticatedEntryIdentityChangeRoute } from "../../../../../../../../lib/entry-identity-admin-route-handlers";

export async function PATCH(request: Request, { params }: { params: Promise<{ raceId: string; entryId: string }> }): Promise<Response> {
  const { raceId, entryId } = await params;
  return authenticatedEntryIdentityChangeRoute(db, request, raceId, entryId);
}

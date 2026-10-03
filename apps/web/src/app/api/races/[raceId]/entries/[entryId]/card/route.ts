import { db } from "../../../../../../../lib/db";
import { authenticatedEntryCardChangeRoute } from "../../../../../../../lib/entry-card-admin-route-handlers";

export async function PATCH(request: Request, { params }: { params: Promise<{ raceId: string; entryId: string }> }) {
  const { raceId, entryId } = await params;
  return authenticatedEntryCardChangeRoute(db, request, raceId, entryId);
}


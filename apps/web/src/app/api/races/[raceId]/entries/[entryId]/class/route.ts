import { db } from "../../../../../../../lib/db";
import { authenticatedEntryClassChangeRoute } from "../../../../../../../lib/entry-class-admin-route-handlers";

export async function PATCH(request: Request, { params }: { params: Promise<{ raceId: string; entryId: string }> }) {
  const { raceId, entryId } = await params;
  return authenticatedEntryClassChangeRoute(db, request, raceId, entryId);
}

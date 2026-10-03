import { db } from "../../../../../../../lib/db";
import { authenticatedEntryStartTimeChangeRoute } from "../../../../../../../lib/entry-start-time-admin-route-handlers";

export async function PATCH(request: Request, { params }: { params: Promise<{ raceId: string; entryId: string }> }) {
  const { raceId, entryId } = await params;
  return authenticatedEntryStartTimeChangeRoute(db, request, raceId, entryId);
}

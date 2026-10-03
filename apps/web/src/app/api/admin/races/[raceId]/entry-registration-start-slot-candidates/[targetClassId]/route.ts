import { db } from "../../../../../../../lib/db";
import { entryRegistrationAdminStartSlotCandidatesRoute } from "../../../../../../../lib/entry-registration-admin-route-handlers";

export async function GET(request: Request, context: { params: Promise<{ raceId: string; targetClassId: string }> }) {
  const { raceId, targetClassId } = await context.params;
  return entryRegistrationAdminStartSlotCandidatesRoute(db, request, raceId, targetClassId);
}

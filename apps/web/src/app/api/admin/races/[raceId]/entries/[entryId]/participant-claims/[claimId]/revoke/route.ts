import { db } from "../../../../../../../../../../lib/db";
import { participantClaimRevokeRoute } from "../../../../../../../../../../lib/participant-entry-claim-route-handlers";

export async function POST(request: Request, context: { params: Promise<{ raceId: string; entryId: string; claimId: string }> }): Promise<Response> {
  const { raceId, entryId, claimId } = await context.params;
  return participantClaimRevokeRoute(db, request, raceId, entryId, claimId);
}

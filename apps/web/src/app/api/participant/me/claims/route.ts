import { db } from "../../../../../lib/db";
import { participantClaimRedeemRoute } from "../../../../../lib/participant-entry-claim-route-handlers";

export async function POST(request: Request): Promise<Response> {
  return participantClaimRedeemRoute(db, request);
}

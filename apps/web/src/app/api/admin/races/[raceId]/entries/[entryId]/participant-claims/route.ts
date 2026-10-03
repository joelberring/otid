import { db } from "../../../../../../../../lib/db";
import { participantClaimIssueRoute, participantClaimListRoute } from "../../../../../../../../lib/participant-entry-claim-route-handlers";

export async function GET(request: Request, context: { params: Promise<{ raceId: string; entryId: string }> }): Promise<Response> {
  const { raceId, entryId } = await context.params;
  return participantClaimListRoute(db, request, raceId, entryId);
}

export async function POST(request: Request, context: { params: Promise<{ raceId: string; entryId: string }> }): Promise<Response> {
  const { raceId, entryId } = await context.params;
  return participantClaimIssueRoute(db, request, raceId, entryId);
}

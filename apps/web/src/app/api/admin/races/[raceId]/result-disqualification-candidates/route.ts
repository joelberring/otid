import { db } from "../../../../../../lib/db";
import { resultDisqualificationCandidateListRoute } from "../../../../../../lib/result-disqualification-admin-route-handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> }
): Promise<Response> {
  return resultDisqualificationCandidateListRoute(db, request, (await params).raceId);
}

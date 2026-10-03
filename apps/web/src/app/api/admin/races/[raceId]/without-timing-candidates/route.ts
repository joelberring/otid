import { db } from "../../../../../../lib/db";
import { withoutTimingCandidateListRoute } from "../../../../../../lib/without-timing-admin-route-handlers";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  return withoutTimingCandidateListRoute(db, request, (await params).raceId);
}

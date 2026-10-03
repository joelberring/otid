import { db } from "../../../../../../lib/db";
import { didNotStartCandidateRoute } from "../../../../../../lib/did-not-start-admin-route-handlers";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  return didNotStartCandidateRoute(db, request, (await params).raceId);
}

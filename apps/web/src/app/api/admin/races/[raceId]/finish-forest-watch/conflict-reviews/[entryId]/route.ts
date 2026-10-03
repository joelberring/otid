import { db } from "../../../../../../../../lib/db";
import { checkinConflictReviewReadRoute } from "../../../../../../../../lib/checkin-conflict-review-route-handlers";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string; entryId: string }> }): Promise<Response> {
  const routeParams = await params;
  return checkinConflictReviewReadRoute(db, request, routeParams.raceId, routeParams.entryId);
}

import { db } from "../../../../../../../lib/db";
import { checkinConflictReviewRoute } from "../../../../../../../lib/checkin-conflict-review-route-handlers";

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  return checkinConflictReviewRoute(db, request, (await params).raceId);
}

import { db } from "../../../../../../lib/db";
import { resultRecalculationCandidateRoute } from "../../../../../../lib/result-recalculation-admin-route-handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> }
): Promise<Response> {
  const { raceId } = await params;
  return resultRecalculationCandidateRoute(db, request, raceId);
}

import { db } from "../../../../../../lib/db";
import { resultDisqualificationWithdrawalListRoute } from "../../../../../../lib/result-disqualification-withdrawal-admin-route-handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> }
): Promise<Response> {
  return resultDisqualificationWithdrawalListRoute(db, request, (await params).raceId);
}

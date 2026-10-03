import { db } from "../../../../../../lib/db";
import { resultApprovalWithdrawalListRoute } from "../../../../../../lib/result-approval-withdrawal-admin-route-handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> }
): Promise<Response> {
  return resultApprovalWithdrawalListRoute(db, request, (await params).raceId);
}

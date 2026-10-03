import { db } from "../../../../../../../../lib/db";
import { authenticatedResultApprovalWithdrawalRoute } from "../../../../../../../../lib/result-approval-withdrawal-admin-route-handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ raceId: string; entryId: string }> }
): Promise<Response> {
  const { raceId, entryId } = await params;
  return authenticatedResultApprovalWithdrawalRoute(db, request, raceId, entryId);
}

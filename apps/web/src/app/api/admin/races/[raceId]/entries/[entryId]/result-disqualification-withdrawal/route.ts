import { db } from "../../../../../../../../lib/db";
import { authenticatedResultDisqualificationWithdrawalRoute } from "../../../../../../../../lib/result-disqualification-withdrawal-admin-route-handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ raceId: string; entryId: string }> }
): Promise<Response> {
  const { raceId, entryId } = await params;
  return authenticatedResultDisqualificationWithdrawalRoute(db, request, raceId, entryId);
}

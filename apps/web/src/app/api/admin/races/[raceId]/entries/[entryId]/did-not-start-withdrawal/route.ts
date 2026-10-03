import { db } from "../../../../../../../../lib/db";
import { authenticatedDidNotStartWithdrawalRoute } from "../../../../../../../../lib/did-not-start-withdrawal-admin-route-handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ raceId: string; entryId: string }> }
): Promise<Response> {
  const { raceId, entryId } = await params;
  return authenticatedDidNotStartWithdrawalRoute(db, request, raceId, entryId);
}

import { db } from "../../../../../../lib/db";
import { didNotStartWithdrawalListRoute } from "../../../../../../lib/did-not-start-withdrawal-admin-route-handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> }
): Promise<Response> {
  return didNotStartWithdrawalListRoute(db, request, (await params).raceId);
}

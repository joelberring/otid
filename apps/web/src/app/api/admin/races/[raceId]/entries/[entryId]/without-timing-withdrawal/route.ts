import { db } from "../../../../../../../../lib/db";
import { authenticatedWithoutTimingWithdrawalRoute } from "../../../../../../../../lib/without-timing-withdrawal-admin-route-handlers";

type Context = { params: Promise<{ raceId: string; entryId: string }> };

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { raceId, entryId } = await params;
  return authenticatedWithoutTimingWithdrawalRoute(db, request, raceId, entryId);
}

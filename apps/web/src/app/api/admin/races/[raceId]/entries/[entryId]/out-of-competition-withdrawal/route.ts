import { db } from "../../../../../../../../lib/db";
import { authenticatedOutOfCompetitionWithdrawalRoute } from "../../../../../../../../lib/out-of-competition-withdrawal-admin-route-handlers";

type Context = { params: Promise<{ raceId: string; entryId: string }> };

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { raceId, entryId } = await params;
  return authenticatedOutOfCompetitionWithdrawalRoute(db, request, raceId, entryId);
}

import { db } from "../../../../../../lib/db";
import { outOfCompetitionWithdrawalListRoute } from "../../../../../../lib/out-of-competition-withdrawal-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return outOfCompetitionWithdrawalListRoute(db, request, (await params).raceId);
}

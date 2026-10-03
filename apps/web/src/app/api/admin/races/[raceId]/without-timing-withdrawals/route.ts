import { db } from "../../../../../../lib/db";
import { withoutTimingWithdrawalListRoute } from "../../../../../../lib/without-timing-withdrawal-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return withoutTimingWithdrawalListRoute(db, request, (await params).raceId);
}

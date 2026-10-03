import { db } from "../../../../../../lib/db";
import { raceOverviewAdminDataRoute } from "../../../../../../lib/race-overview-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return raceOverviewAdminDataRoute(db, request, raceId);
}

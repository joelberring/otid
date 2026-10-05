import { db } from "../../../../../../lib/db";
import { organizerRaceDeleteRoute } from "../../../../../../lib/account-route-handlers";

export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await context.params;
  return organizerRaceDeleteRoute(db, request, raceId);
}

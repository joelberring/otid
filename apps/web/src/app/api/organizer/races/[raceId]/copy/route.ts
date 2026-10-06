import { db } from "../../../../../../lib/db";
import { organizerRaceCopyRoute } from "../../../../../../lib/account-route-handlers";

export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await context.params;
  return organizerRaceCopyRoute(db, request, raceId);
}

import { db } from "../../../../../../lib/db";
import { organizerRaceEnterRoute } from "../../../../../../lib/organizer-account-route-handlers";

export async function POST(
  request: Request,
  context: { params: Promise<{ raceId: string }> }
): Promise<Response> {
  const { raceId } = await context.params;
  return organizerRaceEnterRoute(db, request, raceId);
}

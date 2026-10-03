import { db } from "../../../../../../../lib/db";
import { frozenRaceFinalizationListRoute } from "../../../../../../../lib/iof-result-list-export-admin-route-handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> }
): Promise<Response> {
  const { raceId } = await params;
  return frozenRaceFinalizationListRoute(db, request, raceId);
}

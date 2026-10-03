import { db } from "../../../../../../lib/db";
import { authenticatedResultFinalizationRoute } from "../../../../../../lib/result-finalization-admin-route-handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> }
): Promise<Response> {
  const { raceId } = await params;
  return authenticatedResultFinalizationRoute(db, request, raceId);
}

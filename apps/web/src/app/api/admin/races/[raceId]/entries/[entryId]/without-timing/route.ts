import { db } from "../../../../../../../../lib/db";
import { authenticatedWithoutTimingRoute } from "../../../../../../../../lib/without-timing-admin-route-handlers";

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string; entryId: string }> }): Promise<Response> {
  const { raceId, entryId } = await params;
  return authenticatedWithoutTimingRoute(db, request, raceId, entryId);
}

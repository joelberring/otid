import { db } from "../../../../../../../../lib/db";
import { authenticatedResultDisqualificationRoute } from "../../../../../../../../lib/result-disqualification-admin-route-handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ raceId: string; entryId: string }> }
): Promise<Response> {
  const { raceId, entryId } = await params;
  return authenticatedResultDisqualificationRoute(db, request, raceId, entryId);
}

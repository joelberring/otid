import { db } from "../../../../../../../../lib/db";
import { authenticatedDidNotStartRoute } from "../../../../../../../../lib/did-not-start-admin-route-handlers";

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string; entryId: string }> }): Promise<Response> {
  const { raceId, entryId } = await params;
  return authenticatedDidNotStartRoute(db, request, raceId, entryId);
}

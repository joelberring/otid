import { db } from "../../../../../../../../lib/db";
import { entryReadoutHistoryListRoute } from "../../../../../../../../lib/readout-result-history-admin-route-handlers";

type Context = { params: Promise<{ raceId: string; entryId: string }> };
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId, entryId } = await params;
  return entryReadoutHistoryListRoute(db, request, raceId, entryId);
}

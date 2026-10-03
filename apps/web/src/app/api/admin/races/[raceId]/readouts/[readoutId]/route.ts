import { db } from "../../../../../../../lib/db";
import { readoutHistoryDetailRoute } from "../../../../../../../lib/readout-result-history-admin-route-handlers";

type Context = { params: Promise<{ raceId: string; readoutId: string }> };
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId, readoutId } = await params;
  return readoutHistoryDetailRoute(db, request, raceId, readoutId);
}

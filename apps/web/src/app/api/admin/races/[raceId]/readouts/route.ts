import { db } from "../../../../../../lib/db";
import { readoutHistoryListRoute } from "../../../../../../lib/readout-result-history-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };
export async function GET(request: Request, { params }: Context): Promise<Response> {
  return readoutHistoryListRoute(db, request, (await params).raceId);
}

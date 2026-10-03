import { db } from "../../../../../../../../lib/db";
import { frozenIofResultListDownloadRoute } from "../../../../../../../../lib/iof-result-list-export-admin-route-handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ raceId: string; finalizationId: string }> }
): Promise<Response> {
  const { raceId, finalizationId } = await params;
  return frozenIofResultListDownloadRoute(db, request, raceId, finalizationId);
}

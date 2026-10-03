import { db } from "../../../../../../../../lib/db";
import { mapAssetPreviewRoute } from "../../../../../../../../lib/map-asset-route-handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ raceId: string; uploadId: string }> }) {
  const { raceId, uploadId } = await context.params;
  return mapAssetPreviewRoute(db, request, raceId, uploadId);
}

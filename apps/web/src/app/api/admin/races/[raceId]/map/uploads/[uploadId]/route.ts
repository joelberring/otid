import { db } from "../../../../../../../../lib/db";
import { mapAssetTransferRoute } from "../../../../../../../../lib/map-asset-route-handlers";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ raceId: string; uploadId: string }> }) {
  const { raceId, uploadId } = await context.params;
  return mapAssetTransferRoute(db, request, raceId, uploadId);
}

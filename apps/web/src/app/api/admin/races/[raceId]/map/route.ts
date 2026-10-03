import { db } from "../../../../../../lib/db";
import { mapAssetStateRoute } from "../../../../../../lib/map-asset-route-handlers";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return mapAssetStateRoute(db, request, raceId);
}

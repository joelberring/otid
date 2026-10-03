import { db } from "../../../../../../../lib/db";
import { mapAssetReservationRoute } from "../../../../../../../lib/map-asset-route-handlers";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return mapAssetReservationRoute(db, request, raceId);
}

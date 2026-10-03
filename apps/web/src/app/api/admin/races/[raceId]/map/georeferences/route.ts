import { db } from "../../../../../../../lib/db";
import { createMapGeoreferenceRoute, mapGeoreferenceStateRoute } from "../../../../../../../lib/map-georeference-route-handlers";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return mapGeoreferenceStateRoute(db, request, raceId);
}

export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return createMapGeoreferenceRoute(db, request, raceId);
}

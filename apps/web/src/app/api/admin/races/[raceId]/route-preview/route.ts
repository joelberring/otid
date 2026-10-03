import { db } from "../../../../../../lib/db";
import { privateRoutePreviewRoute } from "../../../../../../lib/private-route-preview-route-handlers";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) { return privateRoutePreviewRoute(db, request, (await context.params).raceId); }

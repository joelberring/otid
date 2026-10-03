import { db } from "../../../../../../../lib/db";
import { privateRoutePreviewMapRoute } from "../../../../../../../lib/private-route-preview-route-handlers";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) { return privateRoutePreviewMapRoute(db, request, (await context.params).raceId); }

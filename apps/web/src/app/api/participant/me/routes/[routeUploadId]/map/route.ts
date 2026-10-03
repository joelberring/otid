import { db } from "../../../../../../../lib/db";
import { participantPrivateRouteMapRoute } from "../../../../../../../lib/private-route-context-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ routeUploadId: string }> }): Promise<Response> {
  return participantPrivateRouteMapRoute(db, request, (await context.params).routeUploadId);
}

import { db } from "../../../../../../lib/db";
import { participantPrivateRouteDetailRoute } from "../../../../../../lib/participant-private-route-route-handlers";

export async function GET(request: Request, context: { params: Promise<{ routeUploadId: string }> }): Promise<Response> {
  return participantPrivateRouteDetailRoute(db, request, (await context.params).routeUploadId);
}

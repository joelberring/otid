import { db } from "../../../../../lib/db";
import { participantPrivateRouteListRoute } from "../../../../../lib/participant-private-route-route-handlers";

export async function GET(request: Request): Promise<Response> {
  return participantPrivateRouteListRoute(db, request);
}

import { db } from "../../../lib/db";
import { authenticatedEventCreationRoute } from "../../../lib/event-creation-admin-route-handlers";

export async function POST(request: Request): Promise<Response> {
  return authenticatedEventCreationRoute(db, request);
}

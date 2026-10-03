import { db } from "../../../../../../../../lib/db";
import { organizerEventAdministratorRevokeRoute } from "../../../../../../../../lib/organizer-account-route-handlers";

type RouteContext = { params: Promise<{ eventId: string; grantId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { eventId, grantId } = await context.params;
  return organizerEventAdministratorRevokeRoute(db, request, eventId, grantId);
}

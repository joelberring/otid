import { db } from "../../../../../../../../lib/db";
import { organizerAccountInvitationRevokeRoute } from "../../../../../../../../lib/organizer-account-invitation-route-handlers";

type RouteContext = { params: Promise<{ eventId: string; invitationId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { eventId, invitationId } = await context.params;
  return organizerAccountInvitationRevokeRoute(db, request, eventId, invitationId);
}

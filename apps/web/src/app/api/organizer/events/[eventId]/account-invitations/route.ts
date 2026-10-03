import { db } from "../../../../../../lib/db";
import {
  organizerAccountInvitationIssueRoute,
  organizerAccountInvitationListRoute
} from "../../../../../../lib/organizer-account-invitation-route-handlers";

type RouteContext = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { eventId } = await context.params;
  return organizerAccountInvitationListRoute(db, request, eventId);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { eventId } = await context.params;
  return organizerAccountInvitationIssueRoute(db, request, eventId);
}

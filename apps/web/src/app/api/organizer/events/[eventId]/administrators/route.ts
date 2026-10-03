import { db } from "../../../../../../lib/db";
import {
  organizerEventAdministratorGrantRoute,
  organizerEventAdministratorsListRoute
} from "../../../../../../lib/organizer-account-route-handlers";

type RouteContext = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { eventId } = await context.params;
  return organizerEventAdministratorsListRoute(db, request, eventId);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { eventId } = await context.params;
  return organizerEventAdministratorGrantRoute(db, request, eventId);
}

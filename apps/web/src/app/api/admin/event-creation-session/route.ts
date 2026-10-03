import { db } from "../../../../lib/db";
import {
  eventCreationLoginRoute,
  eventCreationLogoutRoute,
  eventCreationSessionStatusRoute
} from "../../../../lib/event-creation-admin-route-handlers";

export async function GET(request: Request): Promise<Response> {
  return eventCreationSessionStatusRoute(db, request);
}

export async function POST(request: Request): Promise<Response> {
  return eventCreationLoginRoute(db, request);
}

export async function DELETE(request: Request): Promise<Response> {
  return eventCreationLogoutRoute(db, request);
}

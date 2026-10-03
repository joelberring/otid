import { db } from "../../../../lib/db";
import {
  organizerEventCreateRoute,
  organizerEventsListRoute
} from "../../../../lib/organizer-account-route-handlers";

export async function GET(request: Request): Promise<Response> {
  return organizerEventsListRoute(db, request);
}

export async function POST(request: Request): Promise<Response> {
  return organizerEventCreateRoute(db, request);
}

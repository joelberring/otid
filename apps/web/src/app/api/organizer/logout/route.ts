import { db } from "../../../../lib/db";
import { organizerLogoutRoute } from "../../../../lib/organizer-account-route-handlers";

export async function POST(request: Request): Promise<Response> {
  return organizerLogoutRoute(db, request);
}

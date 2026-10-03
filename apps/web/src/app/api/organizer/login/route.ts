import { db } from "../../../../lib/db";
import { organizerLoginRoute } from "../../../../lib/organizer-account-route-handlers";

export async function POST(request: Request): Promise<Response> {
  return organizerLoginRoute(db, request);
}

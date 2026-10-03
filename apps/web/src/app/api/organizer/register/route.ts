import { db } from "../../../../lib/db";
import { organizerRegisterRoute } from "../../../../lib/organizer-account-route-handlers";

export async function POST(request: Request): Promise<Response> {
  return organizerRegisterRoute(db, request);
}

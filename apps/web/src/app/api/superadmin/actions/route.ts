import { db } from "../../../../lib/db";
import { superadminActionRoute } from "../../../../lib/superadmin-route-handlers";

export async function POST(request: Request): Promise<Response> {
  return superadminActionRoute(db, request);
}

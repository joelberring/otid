import { db } from "../../../lib/db";
import { superadminOverviewRoute } from "../../../lib/superadmin-route-handlers";

export async function GET(request: Request): Promise<Response> {
  return superadminOverviewRoute(db, request);
}

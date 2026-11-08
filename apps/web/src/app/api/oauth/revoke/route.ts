import { db } from "../../../../lib/db";
import { revokeRoute } from "../../../../lib/oauth-route-handlers";

/** ADR-0219 (K2): OAuth (revoke). */
export async function POST(request: Request): Promise<Response> {
  return revokeRoute(db, request);
}

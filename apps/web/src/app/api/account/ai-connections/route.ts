import { db } from "../../../../lib/db";
import { aiConnectionsRoute } from "../../../../lib/oauth-route-handlers";

/** ADR-0219 (K2): kontots AI-kopplingar. */
export async function GET(request: Request): Promise<Response> {
  return aiConnectionsRoute(db, request);
}

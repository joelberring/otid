import { db } from "../../../../lib/db";
import { registerRoute } from "../../../../lib/oauth-route-handlers";

/** ADR-0219 (K2): OAuth (register). */
export async function POST(request: Request): Promise<Response> {
  return registerRoute(db, request);
}

import { db } from "../../../../lib/db";
import { tokenRoute } from "../../../../lib/oauth-route-handlers";

/** ADR-0219 (K2): OAuth (token). */
export async function POST(request: Request): Promise<Response> {
  return tokenRoute(db, request);
}

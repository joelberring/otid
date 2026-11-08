import { db } from "../../../../lib/db";
import { authorizeRoute } from "../../../../lib/oauth-route-handlers";

/** ADR-0219 (K2): sidan för godkännande frågar (GET) och personen svarar (POST). */
export async function GET(request: Request): Promise<Response> {
  return authorizeRoute(db, request);
}

export async function POST(request: Request): Promise<Response> {
  return authorizeRoute(db, request);
}

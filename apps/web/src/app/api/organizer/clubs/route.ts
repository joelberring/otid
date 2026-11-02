import { db } from "../../../../lib/db";
import { clubCreateRoute, clubsListRoute } from "../../../../lib/club-route-handlers";

/** ADR-0194: Mina klubbar (GET) och en ny klubb (POST). */
export async function GET(request: Request): Promise<Response> {
  return clubsListRoute(db, request);
}

export async function POST(request: Request): Promise<Response> {
  return clubCreateRoute(db, request);
}

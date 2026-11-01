import { db } from "../../../../lib/db";
import { groupCreateRoute, groupsListRoute } from "../../../../lib/training-group-route-handlers";

/** Steg 68: Mina grupper (GET) och en ny träningsgrupp (POST). */
export async function GET(request: Request): Promise<Response> {
  return groupsListRoute(db, request);
}

export async function POST(request: Request): Promise<Response> {
  return groupCreateRoute(db, request);
}

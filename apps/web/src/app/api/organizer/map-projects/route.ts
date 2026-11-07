import { db } from "../../../../lib/db";
import { mapProjectsRoute } from "../../../../lib/map-project-route-handlers";

/** ADR-0219: kontots kartprojekt (GET) och ett nytt projekt från en kartversion i klubbarkivet (POST). */
export async function GET(request: Request): Promise<Response> {
  return mapProjectsRoute(db, request);
}

export async function POST(request: Request): Promise<Response> {
  return mapProjectsRoute(db, request);
}

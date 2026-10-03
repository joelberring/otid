import { db } from "../../../../../../lib/db";
import { bindPrivateRouteContextRoute, privateRouteContextStateRoute } from "../../../../../../lib/private-route-context-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }): Promise<Response> {
  return privateRouteContextStateRoute(db, request, (await context.params).raceId);
}
export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }): Promise<Response> {
  return bindPrivateRouteContextRoute(db, request, (await context.params).raceId);
}

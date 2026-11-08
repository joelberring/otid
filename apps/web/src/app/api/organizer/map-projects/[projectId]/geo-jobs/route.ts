import { db } from "../../../../../../lib/db";
import { geoJobsRoute } from "../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K5): projektets geo-jobb (GET) och nytt jobb (POST). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return geoJobsRoute(db, request, projectId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return geoJobsRoute(db, request, projectId);
}

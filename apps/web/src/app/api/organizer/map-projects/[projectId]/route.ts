import { db } from "../../../../../lib/db";
import { mapProjectRoute } from "../../../../../lib/map-project-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219: projektet (GET) och namn eller läge (PUT). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectRoute(db, request, projectId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectRoute(db, request, projectId);
}

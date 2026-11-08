import { db } from "../../../../../../lib/db";
import { mapProjectLayersRoute } from "../../../../../../lib/map-project-layer-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K4a): projektets underlag (GET) och nytt underlag (POST, bilden som kroppen). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectLayersRoute(db, request, projectId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectLayersRoute(db, request, projectId);
}

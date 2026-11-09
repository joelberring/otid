import { db } from "../../../../../../lib/db";
import { mapProjectWorkLayersRoute } from "../../../../../../lib/map-project-work-layer-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Lagren fas 2 (ägaren 2026-11-09): arbetslager och skisslager med skisserna (GET), nytt lager (POST). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectWorkLayersRoute(db, request, projectId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectWorkLayersRoute(db, request, projectId);
}

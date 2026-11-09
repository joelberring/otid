import { db } from "../../../../../../lib/db";
import { mapProjectSketchesRoute } from "../../../../../../lib/map-project-work-layer-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Lagren fas 2: ny skiss i ett skisslager (POST). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectSketchesRoute(db, request, projectId);
}

import { db } from "../../../../../../../lib/db";
import { mapProjectSketchRoute } from "../../../../../../../lib/map-project-work-layer-route-handlers";

type Context = { params: Promise<{ projectId: string; sketchId: string }> };

/** Lagren fas 2: ta bort en skiss (DELETE). */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { projectId, sketchId } = await context.params;
  return mapProjectSketchRoute(db, request, projectId, sketchId);
}

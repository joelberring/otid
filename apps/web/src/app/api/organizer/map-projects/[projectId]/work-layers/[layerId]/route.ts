import { db } from "../../../../../../../lib/db";
import { mapProjectWorkLayerRoute } from "../../../../../../../lib/map-project-work-layer-route-handlers";

type Context = { params: Promise<{ projectId: string; layerId: string }> };

/** Lagren fas 2: ändra (PUT) eller ta bort (DELETE) ett arbetslager eller skisslager. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const { projectId, layerId } = await context.params;
  return mapProjectWorkLayerRoute(db, request, projectId, layerId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { projectId, layerId } = await context.params;
  return mapProjectWorkLayerRoute(db, request, projectId, layerId);
}

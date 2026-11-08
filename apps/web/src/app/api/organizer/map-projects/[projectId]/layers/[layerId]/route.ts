import { db } from "../../../../../../../lib/db";
import { mapProjectLayerRoute } from "../../../../../../../lib/map-project-layer-route-handlers";

type Context = { params: Promise<{ projectId: string; layerId: string }> };

/** ADR-0219 (K4a): ändra (PUT) och ta bort (DELETE) ett underlag. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const { projectId, layerId } = await context.params;
  return mapProjectLayerRoute(db, request, projectId, layerId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { projectId, layerId } = await context.params;
  return mapProjectLayerRoute(db, request, projectId, layerId);
}

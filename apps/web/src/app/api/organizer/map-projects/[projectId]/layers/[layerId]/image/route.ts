import { db } from "../../../../../../../../lib/db";
import { mapProjectLayerImageRoute } from "../../../../../../../../lib/map-project-layer-route-handlers";

type Context = { params: Promise<{ projectId: string; layerId: string }> };

/** ADR-0219 (K4a): underlagets bild. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId, layerId } = await context.params;
  return mapProjectLayerImageRoute(db, request, projectId, layerId);
}

import { db } from "../../../../../../../lib/db";
import { mapProjectPrimarySourceRoute } from "../../../../../../../lib/map-project-primary-route-handlers";

type Context = { params: Promise<{ projectId: string; sourceId: string }> };

/** Huvudkällan (K4c): ta bort markeringen (DELETE). */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { projectId, sourceId } = await context.params;
  return mapProjectPrimarySourceRoute(db, request, projectId, sourceId);
}

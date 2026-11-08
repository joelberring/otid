import { db } from "../../../../../../../lib/db";
import { geoJobRoute } from "../../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ projectId: string; jobId: string }> };

/** ADR-0219 (K5): avbryt ett geo-jobb eller ta bort ett färdigt. */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { projectId, jobId } = await context.params;
  return geoJobRoute(db, request, projectId, jobId);
}

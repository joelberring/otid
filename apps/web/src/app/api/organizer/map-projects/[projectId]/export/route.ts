import { db } from "../../../../../../lib/db";
import { mapProjectExportRoute } from "../../../../../../lib/map-project-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219: ändringarna som egen fil (?format=omap eller geojson). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectExportRoute(db, request, projectId);
}

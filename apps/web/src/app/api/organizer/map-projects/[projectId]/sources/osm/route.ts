import { db } from "../../../../../../../lib/db";
import { mapProjectOsmRoute } from "../../../../../../../lib/map-project-source-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K4c): OpenStreetMap för kartans område eller en etapp, som kandidater. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectOsmRoute(db, request, projectId);
}

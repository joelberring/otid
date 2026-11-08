import { db } from "../../../../../../../lib/db";
import { mapProjectMoistureRoute } from "../../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K5c): SLU:s markfuktighetskarta för en ruta (bilden som svar). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectMoistureRoute(db, request, projectId);
}

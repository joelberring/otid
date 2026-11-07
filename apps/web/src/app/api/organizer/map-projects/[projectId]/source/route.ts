import { db } from "../../../../../../lib/db";
import { mapProjectSourceRoute } from "../../../../../../lib/map-project-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219: grundfilen för projektets medlemmar. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectSourceRoute(db, request, projectId);
}

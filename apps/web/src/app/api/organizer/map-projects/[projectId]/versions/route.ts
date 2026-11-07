import { db } from "../../../../../../lib/db";
import { mapProjectVersionRoute } from "../../../../../../lib/map-project-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219: Skapa ny kartversion ur ändringarna. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectVersionRoute(db, request, projectId);
}

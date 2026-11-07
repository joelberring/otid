import { db } from "../../../../../../../lib/db";
import { mapProjectOutputRoute } from "../../../../../../../lib/map-project-route-handlers";

type Context = { params: Promise<{ projectId: string; outputId: string }> };

/** ADR-0219: en version som skrivits ur projektet, för projektets medlemmar. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId, outputId } = await context.params;
  return mapProjectOutputRoute(db, request, projectId, outputId);
}

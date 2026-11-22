import { db } from "../../../../../../lib/db";
import { mapProjectRegenerableRoute } from "../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** PLAN.md steg M4: underlag i projektet som tagits bort ur förrådet och kan återskapas. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectRegenerableRoute(db, request, projectId);
}

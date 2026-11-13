import { db } from "../../../../../../../lib/db";
import { geoJobsPruneRoute } from "../../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** PLAN.md steg L3: tar bort projektets äldre körningar (den senaste klara behålls). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return geoJobsPruneRoute(db, request, projectId);
}

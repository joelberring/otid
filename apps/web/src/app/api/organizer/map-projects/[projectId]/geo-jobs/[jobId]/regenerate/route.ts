import { db } from "../../../../../../../../lib/db";
import { geoJobRegenerateRoute } from "../../../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ projectId: string; jobId: string }> };

/** PLAN.md steg M4: kör om en laserkörning vars resultat tagits bort ur förrådet (räknas inte mot laserkvoten). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId, jobId } = await context.params;
  return geoJobRegenerateRoute(db, request, projectId, jobId);
}

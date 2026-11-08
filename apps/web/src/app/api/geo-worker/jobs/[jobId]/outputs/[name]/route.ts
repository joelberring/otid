import { db } from "../../../../../../../lib/db";
import { geoWorkerOutputRoute } from "../../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ jobId: string; name: string }> };

/** ADR-0219 (K5): en resultatfil från geo-arbetaren. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const { jobId, name } = await context.params;
  return geoWorkerOutputRoute(db, request, jobId, name);
}

import { db } from "../../../../../../../../../lib/db";
import { geoOutputRoute } from "../../../../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ projectId: string; jobId: string; name: string }> };

/** ADR-0219 (K5): en resultatfil från geo-arbetaren. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId, jobId, name } = await context.params;
  return geoOutputRoute(db, request, projectId, jobId, name);
}

import { db } from "../../../../../../lib/db";
import { geoWorkerInputRoute } from "../../../../../../lib/geo-dwg-route-handlers";

type Context = { params: Promise<{ jobId: string }> };

/** ADR-0219 (K6b): DWG-ritningen för geo-arbetaren. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { jobId } = await context.params;
  return geoWorkerInputRoute(db, request, jobId);
}

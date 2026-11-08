import { db } from "../../../../../../lib/db";
import { geoWorkerFinishRoute } from "../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ jobId: string }> };

/** ADR-0219 (K5): geo-arbetaren är klar med jobbet (eller det misslyckades). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { jobId } = await context.params;
  return geoWorkerFinishRoute(db, request, jobId);
}

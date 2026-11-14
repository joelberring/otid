import { db } from "../../../../../../../../lib/db";
import { geoWorkerStageRoute } from "../../../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ jobId: string; stageId: string; name: string }> };

/** Ägaren 2026-11-14: en etapps resultatfil för geo-arbetaren som lägger ihop etapperna. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { jobId, stageId, name } = await context.params;
  return geoWorkerStageRoute(db, request, jobId, stageId, name);
}

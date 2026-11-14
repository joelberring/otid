import { db } from "../../../../../../../../lib/db";
import { geoJobMergeRoute } from "../../../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ projectId: string; jobId: string }> };

/** Ägaren 2026-11-14: lägg ihop etapperna i en delad laserkörning på geo-servern. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId, jobId } = await context.params;
  return geoJobMergeRoute(db, request, projectId, jobId);
}

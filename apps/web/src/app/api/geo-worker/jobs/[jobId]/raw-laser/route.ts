import { db } from "../../../../../../lib/db";
import { geoWorkerRawLaserRoute } from "../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ jobId: string }> };

/** PLAN.md M6: zip-filen med rå laserdata (uppladdningslänken, klar eller misslyckad). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { jobId } = await context.params;
  return geoWorkerRawLaserRoute(db, request, jobId);
}

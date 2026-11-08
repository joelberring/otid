import { db } from "../../../../../../lib/db";
import { geoWorkerHeartbeatRoute } from "../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ jobId: string }> };

/** ADR-0219 (K5): geo-arbetarens livstecken och förlopp. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { jobId } = await context.params;
  return geoWorkerHeartbeatRoute(db, request, jobId);
}

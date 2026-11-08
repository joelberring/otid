import { db } from "../../../../../../../lib/db";
import { geoWorkerLaserRoute } from "../../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ jobId: string; index: string }> };

/** ADR-0219 (K5): jobbets laserfil, hämtad hos Lantmäteriet med jobbkontots uppgifter. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { jobId, index } = await context.params;
  return geoWorkerLaserRoute(db, request, jobId, index);
}

import { db } from "../../../../../../../lib/db";
import { mapProjectSoilRoute } from "../../../../../../../lib/map-project-source-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Ägaren 2026-11-13: SGU:s jordartskarta (sand, grus, torv m.m.) för kartans område eller en etapp. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectSoilRoute(db, request, projectId);
}

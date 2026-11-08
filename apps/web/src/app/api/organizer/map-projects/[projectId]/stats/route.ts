import { db } from "../../../../../../lib/db";
import { mapProjectStatsRoute } from "../../../../../../lib/map-project-recon-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K3b): projektets statistik och topplista (`?season=2026`). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectStatsRoute(db, request, projectId);
}

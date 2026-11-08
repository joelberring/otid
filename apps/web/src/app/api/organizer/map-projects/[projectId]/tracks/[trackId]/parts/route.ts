import { db } from "../../../../../../../../lib/db";
import { mapProjectTrackPartsRoute } from "../../../../../../../../lib/map-project-recon-route-handlers";

type Context = { params: Promise<{ projectId: string; trackId: string }> };

/** ADR-0219 (K3): en del av ett eget spår (POST). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId, trackId } = await context.params;
  return mapProjectTrackPartsRoute(db, request, projectId, trackId);
}

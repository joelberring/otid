import { db } from "../../../../../../../lib/db";
import { mapLayerProfileRoute } from "../../../../../../../lib/map-layer-profile-route-handlers";

type Context = { params: Promise<{ projectId: string; profileId: string }> };

/** ADR-0219 (K6b): ta bort en egen lagermappningsprofil. */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { projectId, profileId } = await context.params;
  return mapLayerProfileRoute(db, request, projectId, profileId);
}

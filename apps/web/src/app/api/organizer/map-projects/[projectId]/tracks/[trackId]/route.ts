import { db } from "../../../../../../../lib/db";
import { mapProjectTrackRoute } from "../../../../../../../lib/map-project-recon-route-handlers";

type Context = { params: Promise<{ projectId: string; trackId: string }> };

/** ADR-0219 (K3): spårets punkter (GET), byt namn (PUT, eget) och ta bort (DELETE, eget). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId, trackId } = await context.params;
  return mapProjectTrackRoute(db, request, projectId, trackId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { projectId, trackId } = await context.params;
  return mapProjectTrackRoute(db, request, projectId, trackId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { projectId, trackId } = await context.params;
  return mapProjectTrackRoute(db, request, projectId, trackId);
}

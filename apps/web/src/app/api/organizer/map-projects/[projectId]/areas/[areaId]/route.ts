import { db } from "../../../../../../../lib/db";
import { mapProjectAreaRoute } from "../../../../../../../lib/map-project-proposal-route-handlers";

type Context = { params: Promise<{ projectId: string; areaId: string }> };

/** ADR-0219 (K1): ändra (PUT) eller ta bort (DELETE) ett delområde. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const { projectId, areaId } = await context.params;
  return mapProjectAreaRoute(db, request, projectId, areaId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { projectId, areaId } = await context.params;
  return mapProjectAreaRoute(db, request, projectId, areaId);
}

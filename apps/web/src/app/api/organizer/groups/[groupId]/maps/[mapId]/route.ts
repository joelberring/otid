import { db } from "../../../../../../../lib/db";
import { groupMapDeleteRoute, groupMapUpdateRoute } from "../../../../../../../lib/training-group-route-handlers";

type Context = { params: Promise<{ groupId: string; mapId: string }> };

/** Steg 68: kartans namn och avtal (PUT) eller ta bort kartan ur biblioteket (DELETE). */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const { groupId, mapId } = await context.params;
  return groupMapUpdateRoute(db, request, groupId, mapId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { groupId, mapId } = await context.params;
  return groupMapDeleteRoute(db, request, groupId, mapId);
}

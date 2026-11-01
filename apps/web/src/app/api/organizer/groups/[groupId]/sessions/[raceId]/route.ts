import { db } from "../../../../../../../lib/db";
import { groupSessionRemoveRoute } from "../../../../../../../lib/training-group-route-handlers";

/** Steg 68: ta bort ett orört tillfälle. */
export async function DELETE(request: Request, context: { params: Promise<{ groupId: string; raceId: string }> }): Promise<Response> {
  const { groupId, raceId } = await context.params;
  return groupSessionRemoveRoute(db, request, groupId, raceId);
}

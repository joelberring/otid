import { db } from "../../../../../../lib/db";
import { groupMemberAddRoute, groupMemberRemoveRoute } from "../../../../../../lib/training-group-route-handlers";

type Context = { params: Promise<{ groupId: string }> };

/** Steg 68: lägg till en ledare eller medlem (POST) eller ta bort (DELETE). */
export async function POST(request: Request, context: Context): Promise<Response> {
  return groupMemberAddRoute(db, request, (await context.params).groupId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return groupMemberRemoveRoute(db, request, (await context.params).groupId);
}

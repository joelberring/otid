import { db } from "../../../../../../lib/db";
import { groupSessionsCreateRoute } from "../../../../../../lib/training-group-route-handlers";

/** Steg 68: ny träning eller upprepning. */
export async function POST(request: Request, context: { params: Promise<{ groupId: string }> }): Promise<Response> {
  return groupSessionsCreateRoute(db, request, (await context.params).groupId);
}

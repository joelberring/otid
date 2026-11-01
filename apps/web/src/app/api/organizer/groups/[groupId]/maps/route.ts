import { db } from "../../../../../../lib/db";
import { groupMapSaveRoute } from "../../../../../../lib/training-group-route-handlers";

/** Steg 68: spara en tävlings karta i gruppens kartbibliotek. */
export async function POST(request: Request, context: { params: Promise<{ groupId: string }> }): Promise<Response> {
  return groupMapSaveRoute(db, request, (await context.params).groupId);
}

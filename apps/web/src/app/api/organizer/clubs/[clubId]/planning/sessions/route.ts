import { db } from "../../../../../../../lib/db";
import { clubPlanningRoute } from "../../../../../../../lib/club-planning-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0221: terminsplaneringen – ny planerad träning, eller varje vecka till terminens slut. */
async function handle(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubPlanningRoute(db, request, clubId, ["sessions"]);
}

export const POST = handle;

import { db } from "../../../../../../../../lib/db";
import { clubPlanningRoute } from "../../../../../../../../lib/club-planning-route-handlers";

type Context = { params: Promise<{ clubId: string; termId: string }> };

/** ADR-0221: terminsplaneringen – terminens namn och datum (PUT) eller ta bort den tomma terminen (DELETE). */
async function handle(request: Request, context: Context): Promise<Response> {
  const { clubId, termId } = await context.params;
  return clubPlanningRoute(db, request, clubId, ["terms", termId]);
}

export const PUT = handle;
export const DELETE = handle;

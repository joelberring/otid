import { db } from "../../../../../../../../../../lib/db";
import { clubPlanningRoute } from "../../../../../../../../../../lib/club-planning-route-handlers";

type Context = { params: Promise<{ clubId: string; sessionId: string; taskId: string }> };

/** ADR-0221: terminsplaneringen – ta bort uppgiften. */
async function handle(request: Request, context: Context): Promise<Response> {
  const { clubId, sessionId, taskId } = await context.params;
  return clubPlanningRoute(db, request, clubId, ["sessions", sessionId, "tasks", taskId]);
}

export const DELETE = handle;

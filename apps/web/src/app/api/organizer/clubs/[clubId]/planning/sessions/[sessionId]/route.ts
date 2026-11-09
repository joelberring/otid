import { db } from "../../../../../../../../lib/db";
import { clubPlanningRoute } from "../../../../../../../../lib/club-planning-route-handlers";

type Context = { params: Promise<{ clubId: string; sessionId: string }> };

/** ADR-0221: terminsplaneringen – ändra eller ta bort den planerade träningen. */
async function handle(request: Request, context: Context): Promise<Response> {
  const { clubId, sessionId } = await context.params;
  return clubPlanningRoute(db, request, clubId, ["sessions", sessionId]);
}

export const PUT = handle;
export const DELETE = handle;

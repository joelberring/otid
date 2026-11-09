import { db } from "../../../../../../../../../lib/db";
import { clubPlanningRoute } from "../../../../../../../../../lib/club-planning-route-handlers";

type Context = { params: Promise<{ clubId: string; sessionId: string }> };

/** ADR-0221: terminsplaneringen – Skapa träningen. */
async function handle(request: Request, context: Context): Promise<Response> {
  const { clubId, sessionId } = await context.params;
  return clubPlanningRoute(db, request, clubId, ["sessions", sessionId, "race"]);
}

export const POST = handle;

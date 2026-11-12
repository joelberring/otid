import { db } from "../../../../../../../../../lib/db";
import { clubPlanningRoute } from "../../../../../../../../../lib/club-planning-route-handlers";

type Context = { params: Promise<{ clubId: string; sessionId: string }> };

/** Ägaren 2026-11-12: arkivträningens personer till en planerad träning (Använd igen → Till terminsplanen; inga mejl). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId, sessionId } = await context.params;
  return clubPlanningRoute(db, request, clubId, ["sessions", sessionId, "people"]);
}

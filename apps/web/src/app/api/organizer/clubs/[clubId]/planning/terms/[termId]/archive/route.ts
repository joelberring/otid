import { db } from "../../../../../../../../../lib/db";
import { clubPlanningRoute } from "../../../../../../../../../lib/club-planning-route-handlers";

type Context = { params: Promise<{ clubId: string; termId: string }> };

/** Ägaren 2026-11-12: Hämta ur arkivet – en arkivträning blir en planerad träning i terminen (inga mejl). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId, termId } = await context.params;
  return clubPlanningRoute(db, request, clubId, ["terms", termId, "archive"]);
}

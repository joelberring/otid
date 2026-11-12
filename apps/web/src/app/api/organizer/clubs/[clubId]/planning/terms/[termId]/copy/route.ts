import { db } from "../../../../../../../../../lib/db";
import { clubPlanningRoute } from "../../../../../../../../../lib/club-planning-route-handlers";

type Context = { params: Promise<{ clubId: string; termId: string }> };

/** Ägaren 2026-11-12: Kopiera upplägg från termin – en tidigare termins träningar till den tomma terminen (inga mejl). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId, termId } = await context.params;
  return clubPlanningRoute(db, request, clubId, ["terms", termId, "copy"]);
}

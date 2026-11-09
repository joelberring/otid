import { db } from "../../../../../../lib/db";
import { clubPlanningRoute } from "../../../../../../lib/club-planning-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0221: terminsplaneringen – planen (GET, ?term=) och ny termin (POST). */
async function handle(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubPlanningRoute(db, request, clubId, []);
}

export const GET = handle;
export const POST = handle;

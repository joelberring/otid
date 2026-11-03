import { db } from "../../../../../../lib/db";
import { clubMapMergesRoute } from "../../../../../../lib/club-map-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0210: "Slå ihop till en karta". */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubMapMergesRoute(db, request, clubId);
}

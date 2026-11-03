import { db } from "../../../../../../../lib/db";
import { clubMapDismissRoute } from "../../../../../../../lib/club-map-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0210: "Inte samma karta". */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubMapDismissRoute(db, request, clubId);
}

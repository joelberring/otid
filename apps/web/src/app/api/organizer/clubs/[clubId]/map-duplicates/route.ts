import { db } from "../../../../../../lib/db";
import { clubMapDuplicatesRoute } from "../../../../../../lib/club-map-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0210: "Möjliga dubbletter" bland klubbens kartor. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubMapDuplicatesRoute(db, request, clubId);
}

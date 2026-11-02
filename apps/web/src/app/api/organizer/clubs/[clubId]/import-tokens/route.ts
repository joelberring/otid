import { db } from "../../../../../../lib/db";
import { clubImportTokenCreateRoute } from "../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0194 beslut 7: ny importnyckel (visas en gång). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubImportTokenCreateRoute(db, request, clubId);
}

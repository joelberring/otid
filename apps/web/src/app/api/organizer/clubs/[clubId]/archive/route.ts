import { db } from "../../../../../../lib/db";
import { clubArchiveRoute } from "../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0194: hela arkivet (träningarna och kartorna). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubArchiveRoute(db, request, clubId);
}

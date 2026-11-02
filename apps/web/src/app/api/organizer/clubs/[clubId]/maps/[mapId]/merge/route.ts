import { db } from "../../../../../../../../lib/db";
import { clubMapMergeRoute } from "../../../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string; mapId: string }> };

/** ADR-0194 beslut 2: slå ihop kartan med en annan. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId, mapId } = await context.params;
  return clubMapMergeRoute(db, request, clubId, mapId);
}

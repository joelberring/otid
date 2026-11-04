import { db } from "../../../../../../../../lib/db";
import { clubMapMergeUndoRoute } from "../../../../../../../../lib/club-map-route-handlers";

type Context = { params: Promise<{ clubId: string; mergeId: string }> };

/** ADR-0210: "Ångra sammanslagning". */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId, mergeId } = await context.params;
  return clubMapMergeUndoRoute(db, request, clubId, mergeId);
}

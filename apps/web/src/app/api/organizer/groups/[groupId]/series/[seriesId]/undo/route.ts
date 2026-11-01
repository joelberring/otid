import { db } from "../../../../../../../../lib/db";
import { groupSeriesUndoRoute } from "../../../../../../../../lib/training-group-route-handlers";

/** Steg 68: ångra upprepningen för de framtida, orörda tillfällena. */
export async function POST(request: Request, context: { params: Promise<{ groupId: string; seriesId: string }> }): Promise<Response> {
  const { groupId, seriesId } = await context.params;
  return groupSeriesUndoRoute(db, request, groupId, seriesId);
}

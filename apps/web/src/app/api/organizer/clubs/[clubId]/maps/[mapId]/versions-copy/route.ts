import { db } from "../../../../../../../../lib/db";
import { clubMapVersionsCopyRoute } from "../../../../../../../../lib/club-map-route-handlers";

type Context = { params: Promise<{ clubId: string; mapId: string }> };

/** ADR-0210: "Kopiera till alla versioner" och "Från kartan". */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId, mapId } = await context.params;
  return clubMapVersionsCopyRoute(db, request, clubId, mapId);
}

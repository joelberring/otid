import { db } from "../../../../../../../../lib/db";
import { clubMapVersionAttachRaceRoute } from "../../../../../../../../lib/public-map-bank-route-handlers";

type Context = { params: Promise<{ clubId: string; versionId: string }> };

/** Etapp 3.2: serverrenderad koppling av klubbkarta till tävling (för nedladdningsspärrade kartor). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId, versionId } = await context.params;
  return clubMapVersionAttachRaceRoute(db, request, clubId, versionId);
}

import { db } from "../../../../../../../../lib/db";
import { clubMapVersionTargetRoute } from "../../../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string; versionId: string }> };

/** ADR-0194 beslut 5: versionen i en träningsgrupps kartbibliotek. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId, versionId } = await context.params;
  return clubMapVersionTargetRoute(db, request, clubId, versionId, "group");
}

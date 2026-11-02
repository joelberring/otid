import { db } from "../../../../../../lib/db";
import { clubImportContentRoute } from "../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string; sha256: string }> };

/** ADR-0194 beslut 6–7: importen – en kartfil som ström. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const { clubId, sha256 } = await context.params;
  return clubImportContentRoute(db, request, clubId, sha256);
}

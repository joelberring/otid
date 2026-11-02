import { db } from "../../../../../../../lib/db";
import { clubImportTokenRevokeRoute } from "../../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string; tokenId: string }> };

/** ADR-0194 beslut 7: återkalla importnyckeln. */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { clubId, tokenId } = await context.params;
  return clubImportTokenRevokeRoute(db, request, clubId, tokenId);
}

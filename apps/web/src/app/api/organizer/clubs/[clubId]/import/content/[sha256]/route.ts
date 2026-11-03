import { db } from "../../../../../../../../lib/db";
import { clubWebImportContentRoute } from "../../../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string; sha256: string }> };

/** ADR-0204: importen i webbläsaren – en kartfil. Inloggningen och CSRF. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const { clubId, sha256 } = await context.params;
  return clubWebImportContentRoute(db, request, clubId, sha256);
}

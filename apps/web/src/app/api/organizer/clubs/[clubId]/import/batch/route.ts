import { db } from "../../../../../../../lib/db";
import { clubWebImportBatchRoute } from "../../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0204: importen i webbläsaren – kartornas versioner och träningarna. Inloggningen och CSRF. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubWebImportBatchRoute(db, request, clubId);
}

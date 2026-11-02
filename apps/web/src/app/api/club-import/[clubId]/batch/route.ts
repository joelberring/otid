import { db } from "../../../../../lib/db";
import { clubImportBatchRoute } from "../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0194 beslut 6–7: importen – kartornas versioner och träningarna. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubImportBatchRoute(db, request, clubId);
}

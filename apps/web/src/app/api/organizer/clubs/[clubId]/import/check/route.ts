import { db } from "../../../../../../../lib/db";
import { clubWebImportCheckRoute } from "../../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0204: importen i webbläsaren – vilka kartfiler och träningar servern redan har. Inloggningen och CSRF. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubWebImportCheckRoute(db, request, clubId);
}

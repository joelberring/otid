import { db } from "../../../../../lib/db";
import { clubImportCheckRoute } from "../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0194 beslut 6–7: importen – vilka kartfiler servern redan har. Nyckeln i Authorization. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubImportCheckRoute(db, request, clubId);
}

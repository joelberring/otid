import { db } from "../../../../lib/db";
import { clubImportTokenRoute } from "../../../../lib/club-route-handlers";

/** ADR-0194 beslut 6–7: klubben som importnyckeln hör till. Nyckeln i Authorization. */
export async function GET(request: Request): Promise<Response> {
  return clubImportTokenRoute(db, request);
}

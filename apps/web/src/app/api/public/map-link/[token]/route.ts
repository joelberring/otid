import { db } from "../../../../../lib/db";
import { mapLinkViewRoute } from "../../../../../lib/map-link-route-handlers";

/** ADR-0214: kartfelen med kartritarens länk (nyckeln i adressen är behörigheten; lib/map-link-route-handlers.ts). */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return mapLinkViewRoute(db, request, token);
}

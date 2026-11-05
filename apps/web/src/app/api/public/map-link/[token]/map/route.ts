import { db } from "../../../../../../lib/db";
import { mapLinkMapRoute } from "../../../../../../lib/map-link-route-handlers";

/** ADR-0214: kartfilen som sidan med kartritarens länk ritar (bara med en giltig länk). */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return mapLinkMapRoute(db, request, token);
}

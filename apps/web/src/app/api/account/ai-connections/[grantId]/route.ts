import { db } from "../../../../../lib/db";
import { aiConnectionsRoute } from "../../../../../lib/oauth-route-handlers";

/** ADR-0219 (K2): återkalla en AI-koppling. */
export async function DELETE(request: Request, context: { params: Promise<{ grantId: string }> }): Promise<Response> {
  return aiConnectionsRoute(db, request, (await context.params).grantId);
}

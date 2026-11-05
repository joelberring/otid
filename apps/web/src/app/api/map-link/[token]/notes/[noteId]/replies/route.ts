import { db } from "../../../../../../../lib/db";
import { mapLinkWriteRoute } from "../../../../../../../lib/map-link-route-handlers";

/** ADR-0214: kartritarens svar i ett kartfels tråd (nyckeln och samma ursprung, ingen session). */
export async function POST(request: Request, context: { params: Promise<{ token: string; noteId: string }> }) {
  const { token, noteId } = await context.params;
  return mapLinkWriteRoute(db, request, token, noteId, "reply");
}

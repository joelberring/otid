import { db } from "../../../../../../../lib/db";
import { invitationResendRoute } from "../../../../../../../lib/invitation-route-handlers";

type Context = { params: Promise<{ projectId: string; invitationId: string }> };

/** ADR-0206/0219: Skicka igen eller Kopiera länken för en öppen inbjudan till kartprojektet. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId, invitationId } = await context.params;
  return invitationResendRoute(db, request, { kind: "MAP_PROJECT", projectId }, invitationId);
}

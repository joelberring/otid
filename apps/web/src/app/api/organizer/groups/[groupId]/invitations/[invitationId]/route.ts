import { db } from "../../../../../../../lib/db";
import { invitationResendRoute } from "../../../../../../../lib/invitation-route-handlers";

type Context = { params: Promise<{ groupId: string; invitationId: string }> };

/** ADR-0206: Skicka igen eller Kopiera länken för en öppen inbjudan till träningsgruppen. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { groupId, invitationId } = await context.params;
  return invitationResendRoute(db, request, { kind: "GROUP", groupId }, invitationId);
}

import { db } from "../../../../../../../lib/db";
import { invitationResendRoute } from "../../../../../../../lib/invitation-route-handlers";

type Context = { params: Promise<{ clubId: string; invitationId: string }> };

/** ADR-0206: Skicka igen eller Kopiera länken för en öppen inbjudan till klubben. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId, invitationId } = await context.params;
  return invitationResendRoute(db, request, { kind: "CLUB", clubId }, invitationId);
}

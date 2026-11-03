import { db } from "../../../../../../../../../lib/db";
import { invitationResendRoute } from "../../../../../../../../../lib/invitation-route-handlers";

type Context = { params: Promise<{ raceId: string; invitationId: string }> };

/** ADR-0206: Skicka igen eller Kopiera länken för en öppen inbjudan under Personer med behörighet. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { raceId, invitationId } = await context.params;
  return invitationResendRoute(db, request, { kind: "RACE", raceId }, invitationId);
}

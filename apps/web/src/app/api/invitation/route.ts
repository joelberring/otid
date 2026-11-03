import { db } from "../../../lib/db";
import { invitationLinkRoute } from "../../../lib/invitation-route-handlers";

/** ADR-0206: länksidan (/inbjudan#token=…) frågar vad inbjudan gäller. */
export async function POST(request: Request): Promise<Response> {
  return invitationLinkRoute(db, request);
}

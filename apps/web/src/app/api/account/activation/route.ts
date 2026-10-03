import { db } from "../../../../lib/db";
import { accountInvitationActivationRoute } from "../../../../lib/account-invitation-route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return accountInvitationActivationRoute(db, request);
}

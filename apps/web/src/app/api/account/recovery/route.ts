import { db } from "../../../../lib/db";
import { accountPasswordRecoveryRoute } from "../../../../lib/account-password-recovery-route-handler";

export async function POST(request: Request): Promise<Response> {
  return accountPasswordRecoveryRoute(db, request);
}

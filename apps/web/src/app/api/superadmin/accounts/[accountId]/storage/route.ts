import { db } from "../../../../../../lib/db";
import { superadminAccountStorageRoute } from "../../../../../../lib/superadmin-route-handlers";

type Context = { params: Promise<{ accountId: string }> };

/** PLAN.md steg L2: superadmin ser ett kontos kartlagring per kartprojekt. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { accountId } = await context.params;
  return superadminAccountStorageRoute(db, request, accountId);
}

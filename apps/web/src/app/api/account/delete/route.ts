import { db } from "../../../../lib/db";
import { accountDeleteRoute } from "../../../../lib/account-route-handlers";

export async function POST(request: Request): Promise<Response> {
  return accountDeleteRoute(db, request);
}

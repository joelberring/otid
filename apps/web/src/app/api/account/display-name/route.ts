import { db } from "../../../../lib/db";
import { accountDisplayNameRoute } from "../../../../lib/account-route-handlers";

export async function POST(request: Request): Promise<Response> {
  return accountDisplayNameRoute(db, request);
}

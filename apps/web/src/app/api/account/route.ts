import { db } from "../../../lib/db";
import { accountProfileRoute } from "../../../lib/account-route-handlers";

export async function GET(request: Request): Promise<Response> {
  return accountProfileRoute(db, request);
}

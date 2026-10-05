import { db } from "../../../../lib/db";
import { accountPasswordRoute } from "../../../../lib/account-route-handlers";

export async function POST(request: Request): Promise<Response> {
  return accountPasswordRoute(db, request);
}

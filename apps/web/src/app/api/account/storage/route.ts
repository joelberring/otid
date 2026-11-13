import { db } from "../../../../lib/db";
import { accountStorageRoute } from "../../../../lib/account-route-handlers";

export async function GET(request: Request): Promise<Response> {
  return accountStorageRoute(db, request);
}

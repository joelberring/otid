import { db } from "../../../../../lib/db";
import { passwordResetCompleteRoute } from "../../../../../lib/account-route-handlers";

export async function POST(request: Request): Promise<Response> {
  return passwordResetCompleteRoute(db, request);
}

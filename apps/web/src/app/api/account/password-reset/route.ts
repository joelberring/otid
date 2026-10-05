import { db } from "../../../../lib/db";
import { passwordResetAvailabilityRoute, passwordResetRequestRoute } from "../../../../lib/account-route-handlers";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return passwordResetAvailabilityRoute(request);
}

export async function POST(request: Request): Promise<Response> {
  return passwordResetRequestRoute(db, request);
}

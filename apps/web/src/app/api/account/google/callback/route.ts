import { db } from "../../../../../lib/db";
import { googleCallbackRoute } from "../../../../../lib/google-route-handlers";

export const dynamic = "force-dynamic";

/** ADR-0205: tillbaka från Google (`{O_TID_PUBLIC_ORIGIN}/api/account/google/callback`). */
export async function GET(request: Request): Promise<Response> {
  return googleCallbackRoute(db, request);
}

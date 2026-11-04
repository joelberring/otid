import { db } from "../../../../../lib/db";
import { googleUnlinkRoute } from "../../../../../lib/google-link-route-handlers";

export const dynamic = "force-dynamic";

/** ADR-0205 tillägg: "Ta bort kopplingen" till Google-kontot. */
export async function POST(request: Request): Promise<Response> {
  return googleUnlinkRoute(db, request);
}

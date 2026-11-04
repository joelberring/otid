import { db } from "../../../../../lib/db";
import { googleLinkStartRoute } from "../../../../../lib/google-link-route-handlers";

export const dynamic = "force-dynamic";

/** ADR-0205 tillägg: "Koppla Google-konto" under Mitt konto – adressen till Google, bunden till sessionen. */
export async function POST(request: Request): Promise<Response> {
  return googleLinkStartRoute(db, request);
}

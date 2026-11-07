import { db } from "../../../../../lib/db";
import { googleDeleteStartRoute } from "../../../../../lib/google-link-route-handlers";

export const dynamic = "force-dynamic";

/** Ändrat 2026-11-07 (ADR-0205): "Ta bort kontot" med en ny inloggning hos Google – adressen till Google, bunden till sessionen. */
export async function POST(request: Request): Promise<Response> {
  return googleDeleteStartRoute(db, request);
}

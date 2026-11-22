import { db } from "../../../../lib/db";
import { guestDemoRoute } from "../../../../lib/guest-demo-route-handlers";
import { countVisit } from "../../../../lib/visitor-tracking";

/**
 * Demoläget del 2: "Prova arbetsytan" på startsidan (formulär, POST). Besöksstatistiken (ägaren 2026-11-22): en gästdemo som
 * startade (vidare till arbetsytan) räknas i steget "provat arbetsytan".
 */
export async function POST(request: Request): Promise<Response> {
  const response = await guestDemoRoute(db, request);
  if (response.headers.get("location")?.startsWith("/admin/")) countVisit("GUEST_DEMO", request.headers);
  return response;
}

import { db } from "../../../../lib/db";
import { guestDemoRoute } from "../../../../lib/guest-demo-route-handlers";

/** Demoläget del 2: "Prova arbetsytan" på startsidan (formulär, POST). */
export async function POST(request: Request): Promise<Response> {
  return guestDemoRoute(db, request);
}

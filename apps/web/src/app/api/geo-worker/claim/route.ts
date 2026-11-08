import { db } from "../../../../lib/db";
import { geoWorkerClaimRoute } from "../../../../lib/geo-route-handlers";

/** ADR-0219 (K5): geo-arbetaren hämtar nästa jobb (nyckeln i Authorization). */
export async function POST(request: Request): Promise<Response> {
  return geoWorkerClaimRoute(db, request);
}

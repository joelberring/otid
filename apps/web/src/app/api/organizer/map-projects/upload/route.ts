import { db } from "../../../../../lib/db";
import { mapProjectUploadRoute } from "../../../../../lib/map-project-route-handlers";

/** ADR-0219 (rättelsen 2026-11-07): nytt eget kartprojekt från en kartfil, för alla inloggade. */
export async function POST(request: Request): Promise<Response> {
  return mapProjectUploadRoute(db, request);
}

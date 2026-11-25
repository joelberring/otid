import { db } from "../../../../lib/db";
import { publicMapBankListRoute } from "../../../../lib/public-map-bank-route-handlers";

/** Etapp 3.2: publik listning av kartor i kartbanken (`/kartbank`). */
export async function GET(request: Request): Promise<Response> {
  return publicMapBankListRoute(db, request);
}

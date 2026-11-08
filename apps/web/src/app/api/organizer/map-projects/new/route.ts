import { db } from "../../../../../lib/db";
import { mapProjectNewRoute } from "../../../../../lib/map-project-route-handlers";

/** ADR-0219 (K1): ett nytt projekt med en ny tom karta (O-Tids symbolset, område och skala). */
export async function POST(request: Request): Promise<Response> {
  return mapProjectNewRoute(db, request);
}

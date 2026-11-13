import { db } from "../../../../../lib/db";
import { mapProjectJoinRoute } from "../../../../../lib/map-project-join-route-handlers";

/** Gå med i ett kartprojekt med en länk (inloggad). */
export async function POST(request: Request): Promise<Response> {
  return mapProjectJoinRoute(db, request);
}

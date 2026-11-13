import { db } from "../../../lib/db";
import { mapProjectJoinLinkInfoRoute } from "../../../lib/map-project-join-route-handlers";

/** Länksidan (/kartlank#token=…) frågar vad länken gäller. */
export async function POST(request: Request): Promise<Response> {
  return mapProjectJoinLinkInfoRoute(db, request);
}

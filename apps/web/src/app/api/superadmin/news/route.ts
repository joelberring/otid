import { db } from "../../../../lib/db";
import { newsListRoute, newsWriteRoute } from "../../../../lib/news-route-handlers";

/** ADR-0230: superadmins nyheter (alla, också klubbarnas för moderering). POST skriver en allmän nyhet. */
export async function GET(request: Request): Promise<Response> {
  return newsListRoute(db, request, { kind: "SUPERADMIN" });
}

export async function POST(request: Request): Promise<Response> {
  return newsWriteRoute(db, request, { kind: "SUPERADMIN" });
}

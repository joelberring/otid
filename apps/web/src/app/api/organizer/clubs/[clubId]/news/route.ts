import { db } from "../../../../../../lib/db";
import { newsListRoute, newsWriteRoute } from "../../../../../../lib/news-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0230: klubbens nyheter. Medlemmar läser; ledare, administratörer och ägare skriver (POST). */
export async function GET(request: Request, context: Context): Promise<Response> {
  return newsListRoute(db, request, { kind: "CLUB", clubId: (await context.params).clubId });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return newsWriteRoute(db, request, { kind: "CLUB", clubId: (await context.params).clubId });
}

import { db } from "../../../../../../lib/db";
import { newsImageRoute } from "../../../../../../lib/news-route-handlers";
import { accountSessionToken } from "../../../../../../lib/public-race-gate";

/** ADR-0230: en nyhets bild för den som får se nyheten. */
export async function GET(request: Request, context: { params: Promise<{ newsId: string }> }): Promise<Response> {
  return newsImageRoute(db, request, (await context.params).newsId, await accountSessionToken());
}

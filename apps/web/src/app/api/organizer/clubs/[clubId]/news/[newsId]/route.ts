import { db } from "../../../../../../../lib/db";
import { newsWriteRoute } from "../../../../../../../lib/news-route-handlers";

type Context = { params: Promise<{ clubId: string; newsId: string }> };

/** ADR-0230: ändra, dölj (PUT) eller ta bort (DELETE) en av klubbens nyheter. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const { clubId, newsId } = await context.params;
  return newsWriteRoute(db, request, { kind: "CLUB", clubId }, newsId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { clubId, newsId } = await context.params;
  return newsWriteRoute(db, request, { kind: "CLUB", clubId }, newsId);
}

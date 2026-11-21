import { db } from "../../../../../lib/db";
import { newsWriteRoute } from "../../../../../lib/news-route-handlers";

type Context = { params: Promise<{ newsId: string }> };

/** ADR-0230: ändra, dölj eller ta bort vilken nyhet som helst (superadmin). */
export async function PUT(request: Request, context: Context): Promise<Response> {
  return newsWriteRoute(db, request, { kind: "SUPERADMIN" }, (await context.params).newsId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return newsWriteRoute(db, request, { kind: "SUPERADMIN" }, (await context.params).newsId);
}

import { db } from "../../../../../../lib/db";
import { mapProjectJoinLinksRoute } from "../../../../../../lib/map-project-join-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Länkar för att gå med i kartprojektet: skapa (POST) och ta bort (DELETE). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectJoinLinksRoute(db, request, projectId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectJoinLinksRoute(db, request, projectId);
}

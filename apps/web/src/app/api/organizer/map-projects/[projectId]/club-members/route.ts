import { db } from "../../../../../../lib/db";
import { mapProjectClubMembersRoute } from "../../../../../../lib/map-project-join-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Klubbmedlemmar att lägga till i kartprojektet: lista (GET) och lägg till (POST). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectClubMembersRoute(db, request, projectId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectClubMembersRoute(db, request, projectId);
}

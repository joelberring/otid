import { db } from "../../../../../../lib/db";
import { mapProjectTracksRoute } from "../../../../../../lib/map-project-recon-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K3): projektets GPS-spår (GET, alla medlemmar) och nytt eget spår (POST). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectTracksRoute(db, request, projectId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectTracksRoute(db, request, projectId);
}

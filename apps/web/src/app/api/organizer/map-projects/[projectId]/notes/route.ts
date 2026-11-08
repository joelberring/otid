import { db } from "../../../../../../lib/db";
import { mapProjectNotesRoute } from "../../../../../../lib/map-project-recon-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K3): projektets notiser (GET, alla medlemmar) och ny notis (POST, Föreslå eller mer). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectNotesRoute(db, request, projectId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectNotesRoute(db, request, projectId);
}

import { db } from "../../../../../../lib/db";
import { mapProjectChecksRoute } from "../../../../../../lib/map-project-recon-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K3): bekräftade objekt (GET, alla medlemmar) och bekräfta eller ta bort (POST, Föreslå eller mer). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectChecksRoute(db, request, projectId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectChecksRoute(db, request, projectId);
}

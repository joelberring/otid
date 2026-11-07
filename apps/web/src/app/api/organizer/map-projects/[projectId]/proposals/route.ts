import { db } from "../../../../../../lib/db";
import { mapProjectProposalsRoute } from "../../../../../../lib/map-project-proposal-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K1): projektets förslag (GET) och ett nytt förslag med anteckning (POST). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectProposalsRoute(db, request, projectId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectProposalsRoute(db, request, projectId);
}

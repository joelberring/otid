import { db } from "../../../../../../lib/db";
import { mapProjectSyncRoute } from "../../../../../../lib/map-project-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219: synken (egna ändringar ut, andras in). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectSyncRoute(db, request, projectId);
}

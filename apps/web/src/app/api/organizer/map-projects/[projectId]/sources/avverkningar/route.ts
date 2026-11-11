import { db } from "../../../../../../../lib/db";
import { mapProjectClearCutsRoute } from "../../../../../../../lib/map-project-source-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Ägaren 2026-11-11: Skogsstyrelsens utförda avverkningar (hyggen med datum) för kartans område eller en etapp. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectClearCutsRoute(db, request, projectId);
}

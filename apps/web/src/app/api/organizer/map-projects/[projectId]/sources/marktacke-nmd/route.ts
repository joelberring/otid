import { db } from "../../../../../../../lib/db";
import { mapProjectLandCoverRoute } from "../../../../../../../lib/map-project-source-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Ägaren 2026-11-17: Naturvårdsverkets marktäckedata (NMD2023) för kartans område eller en etapp. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectLandCoverRoute(db, request, projectId);
}

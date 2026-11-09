import { db } from "../../../../../../../lib/db";
import { geoDwgJobRoute } from "../../../../../../../lib/geo-dwg-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K6b): en DWG-ritning som geo-arbetaren gör om till DXF. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return geoDwgJobRoute(db, request, projectId);
}

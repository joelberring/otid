import { db } from "../../../../../../../lib/db";
import { mapProjectForestImageRoute } from "../../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Ägaren 2026-11-11: Skogsstyrelsens kartbilder för en ruta (bilden som svar), att lägga som underlag. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectForestImageRoute(db, request, projectId);
}

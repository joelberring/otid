import { db } from "../../../../../../../../lib/db";
import { mapProjectWmsImageRoute } from "../../../../../../../../lib/wms-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Ortofoto från WMS: en bildruta för kartans ruta (bilden som svar). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectWmsImageRoute(db, request, projectId);
}

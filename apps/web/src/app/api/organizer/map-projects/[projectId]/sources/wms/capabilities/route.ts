import { db } from "../../../../../../../../lib/db";
import { mapProjectWmsCapabilitiesRoute } from "../../../../../../../../lib/wms-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Ortofoto från WMS: tjänstens lager för en adress. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectWmsCapabilitiesRoute(db, request, projectId);
}

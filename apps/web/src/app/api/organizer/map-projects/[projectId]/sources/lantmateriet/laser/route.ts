import { db } from "../../../../../../../../lib/db";
import { mapProjectLaserSearchRoute } from "../../../../../../../../lib/geo-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K5): sök laserrutor hos Lantmäteriet med kontots egna uppgifter. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectLaserSearchRoute(db, request, projectId);
}

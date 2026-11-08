import { db } from "../../../../../../../../lib/db";
import { mapProjectOrthoSearchRoute } from "../../../../../../../../lib/map-project-source-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K4c): sök ortofoton hos Lantmäteriet med kontots egna uppgifter. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectOrthoSearchRoute(db, request, projectId);
}

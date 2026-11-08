import { db } from "../../../../../../../../lib/db";
import { mapProjectOrthoAssetRoute } from "../../../../../../../../lib/map-project-source-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K4c): en del av en ortofotobild (Range) med kontots egna uppgifter till Lantmäteriet. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectOrthoAssetRoute(db, request, projectId);
}

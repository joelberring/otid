import { db } from "../../../../../../../../../lib/db";
import { routeUploadGrantRevokeRoute } from "../../../../../../../../../lib/route-upload-grant-route-handlers";

export async function POST(request: Request, context: { params: Promise<{ raceId: string; grantId: string }> }): Promise<Response> {
  const { raceId, grantId } = await context.params;
  return routeUploadGrantRevokeRoute(db, request, raceId, grantId);
}

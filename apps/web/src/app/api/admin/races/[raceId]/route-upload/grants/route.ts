import { db } from "../../../../../../../lib/db";
import { routeUploadGrantIssueRoute, routeUploadGrantListRoute } from "../../../../../../../lib/route-upload-grant-route-handlers";

export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await context.params;
  return routeUploadGrantListRoute(db, request, raceId);
}

export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await context.params;
  return routeUploadGrantIssueRoute(db, request, raceId);
}

import { db } from "../../../../../../lib/db";
import { startListAdminListRoute } from "../../../../../../lib/start-list-admin-route-handlers";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await params;
  return startListAdminListRoute(db, request, raceId);
}

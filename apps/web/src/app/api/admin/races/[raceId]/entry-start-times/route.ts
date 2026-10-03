import { db } from "../../../../../../lib/db";
import { entryStartTimeAdminListRoute } from "../../../../../../lib/entry-start-time-admin-route-handlers";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await params;
  return entryStartTimeAdminListRoute(db, request, raceId);
}

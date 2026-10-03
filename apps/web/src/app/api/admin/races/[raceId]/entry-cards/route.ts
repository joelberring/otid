import { db } from "../../../../../../lib/db";
import { entryCardAdminListRoute } from "../../../../../../lib/entry-card-admin-route-handlers";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await params;
  return entryCardAdminListRoute(db, request, raceId);
}


import { db } from "../../../../../../lib/db";
import { entryClassAdminListRoute } from "../../../../../../lib/entry-class-admin-route-handlers";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await params;
  return entryClassAdminListRoute(db, request, raceId);
}

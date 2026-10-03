import { db } from "../../../../../../lib/db";
import { entryRegistrationAdminListRoute } from "../../../../../../lib/entry-registration-admin-route-handlers";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await params;
  return entryRegistrationAdminListRoute(db, request, raceId);
}

import { db } from "../../../../../lib/db";
import { authenticatedEntryRegistrationRoute } from "../../../../../lib/entry-registration-admin-route-handlers";

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return authenticatedEntryRegistrationRoute(db, request, raceId);
}

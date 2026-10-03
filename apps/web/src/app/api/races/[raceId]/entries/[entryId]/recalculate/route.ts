import { db } from "../../../../../../../lib/db";
import { authenticatedResultRecalculationRoute } from "../../../../../../../lib/result-recalculation-admin-route-handlers";

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string; entryId: string }> }) {
  const { raceId, entryId } = await params;
  return authenticatedResultRecalculationRoute(db, request, raceId, entryId);
}

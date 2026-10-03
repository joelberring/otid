import { db } from "../../../../../lib/db";
import { authenticatedIofImportRoute } from "../../../../../lib/import-admin-route-handlers";

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return authenticatedIofImportRoute(db, request, raceId);
}

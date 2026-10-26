import { db } from "../../../../../lib/db";
import { authenticatedIofImportRoute } from "../../../../../lib/import-admin-route-handlers";
import { bumpRaceChangeGeneration } from "../../../../../lib/race-change-generation";

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const response = await authenticatedIofImportRoute(db, request, raceId);
  // Steg 54: en import syns direkt i arbetsytans delade vyer.
  if (response.ok) bumpRaceChangeGeneration(raceId);
  return response;
}

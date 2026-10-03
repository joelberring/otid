import { db } from "../../../../../../../lib/db";
import { readoutIngestRoute } from "../../../../../../../lib/readout-station-route-handlers";

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return readoutIngestRoute(db, request, raceId);
}

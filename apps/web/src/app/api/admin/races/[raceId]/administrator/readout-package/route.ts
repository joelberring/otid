import { db } from "../../../../../../../lib/db";
import { readoutPackageRoute } from "../../../../../../../lib/readout-station-route-handlers";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return readoutPackageRoute(db, request, raceId);
}

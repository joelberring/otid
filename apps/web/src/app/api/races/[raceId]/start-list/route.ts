import { db } from "../../../../../lib/db";
import { publicStartListRoute } from "../../../../../lib/public-start-list-route";
import { publicRaceResponse } from "../../../../../lib/public-race-gate";
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, () => publicStartListRoute(db, raceId));
}

import { cachedPublicStartList } from "../../../../../lib/public-race-data";
import { cachedPublicStartListRoute } from "../../../../../lib/public-start-list-route";
import { publicRaceResponse } from "../../../../../lib/public-race-gate";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, () => cachedPublicStartListRoute(request, () => cachedPublicStartList(raceId)));
}

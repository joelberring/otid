import { cachedJsonResponse } from "../../../../../../lib/public-race-cache";
import { cachedPublicResults } from "../../../../../../lib/public-race-data";
import { publicRaceResponse } from "../../../../../../lib/public-race-gate";

/** Den publika resultatlistan, räknad en gång per tävlingsversion (steg 51). */
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, async () => cachedJsonResponse(request, await cachedPublicResults(raceId), "public, max-age=2, stale-while-revalidate=3"));
}

import { cachedJsonResponse } from "../../../../../../lib/public-race-cache";
import { cachedPublicRelayResults } from "../../../../../../lib/public-race-data";
import { publicRaceResponse } from "../../../../../../lib/public-race-gate";

/** Publika stafettresultat: lagresultat och sträckresultat (ADR-0169 beslut 3), en gång per tävlingsversion (steg 51). */
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, async () => cachedJsonResponse(request, await cachedPublicRelayResults(raceId), "public, max-age=2, stale-while-revalidate=3"));
}

import { cachedJsonResponse } from "../../../../../../lib/public-race-cache";
import { cachedPublicLive } from "../../../../../../lib/public-race-data";
import { publicRaceResponse } from "../../../../../../lib/public-race-gate";

/** Live för publiken (PLAN.md steg 30): senast i mål, ledare per klass och radiopassager, bakom samma grind som resultaten. */
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, async () => cachedJsonResponse(request, await cachedPublicLive(raceId), "public, max-age=2, stale-while-revalidate=3"));
}

import { cachedJsonResponse } from "../../../../../../lib/public-race-cache";
import { cachedPublicRadio } from "../../../../../../lib/public-race-data";
import { publicRaceResponse } from "../../../../../../lib/public-race-gate";

/** Mellantider vid radiokontrollerna (ADR-0172 beslut 5), bakom samma grind som resultaten. */
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, async () => cachedJsonResponse(request, await cachedPublicRadio(raceId), "public, max-age=2, stale-while-revalidate=3"));
}

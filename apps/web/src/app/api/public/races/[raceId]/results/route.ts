import { cachedJsonResponse } from "../../../../../../lib/public-race-cache";
import { cachedPublicResults, cachedStaffResults } from "../../../../../../lib/public-race-data";
import { publicRaceStaffResponse } from "../../../../../../lib/public-race-gate";

/** Den publika resultatlistan, räknad en gång per tävlingsversion (steg 51). */
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  // Steg 52: arrangören och funktionärerna ser gafflingsbilden även när banorna är hemliga publikt (utan cache, privat).
  // Steg 54: också deras lista räknas en gång per tävlingsversion (en egen, privat; grinden kontrollerar varje anrop).
  return publicRaceStaffResponse(raceId, async staff => staff
    ? cachedJsonResponse(request, await cachedStaffResults(raceId), "private, no-store, no-transform")
    : cachedJsonResponse(request, await cachedPublicResults(raceId), "public, max-age=2, stale-while-revalidate=3"));
}

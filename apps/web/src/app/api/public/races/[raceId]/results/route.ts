import { cachedJsonResponse, compactResultsEntry } from "../../../../../../lib/public-race-cache";
import { cachedPublicResults, cachedStaffResults } from "../../../../../../lib/public-race-data";
import { publicRaceStaffResponse } from "../../../../../../lib/public-race-gate";

/** Den publika resultatlistan, räknad en gång per tävlingsversion (steg 51). `?splits=0` ger kompakt svar utan sträcktider. */
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const compact = new URL(request.url).searchParams.get("splits") === "0";
  // Steg 52: arrangören och funktionärerna ser gafflingsbilden även när banorna är hemliga publikt (utan cache, privat).
  // Steg 54: också deras lista räknas en gång per tävlingsversion (en egen, privat; grinden kontrollerar varje anrop).
  return publicRaceStaffResponse(raceId, async staff => {
    const entry = staff ? await cachedStaffResults(raceId) : await cachedPublicResults(raceId);
    const payload = compact ? compactResultsEntry(entry) : entry;
    return cachedJsonResponse(request, payload, staff ? "private, no-store, no-transform" : "public, max-age=2, stale-while-revalidate=3");
  });
}

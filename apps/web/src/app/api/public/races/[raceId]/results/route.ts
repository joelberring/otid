import { publicResults } from "@o-tid/application";
import { db } from "../../../../../../lib/db";
import { cachedJsonResponse } from "../../../../../../lib/public-race-cache";
import { cachedPublicResults } from "../../../../../../lib/public-race-data";
import { publicRaceStaffResponse } from "../../../../../../lib/public-race-gate";

/** Den publika resultatlistan, räknad en gång per tävlingsversion (steg 51). */
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  // Steg 52: arrangören och funktionärerna ser gafflingsbilden även när banorna är hemliga publikt (utan cache, privat).
  return publicRaceStaffResponse(raceId, async staff => staff
    ? Response.json(await publicResults(db, raceId, { staff }))
    : cachedJsonResponse(request, await cachedPublicResults(raceId), "public, max-age=2, stale-while-revalidate=3"));
}

import { publicResults } from "@o-tid/application";
import { db } from "../../../../../../lib/db";
import { publicRaceStaffResponse } from "../../../../../../lib/public-race-gate";

export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  // Steg 52: arrangören och funktionärerna ser gafflingsbilden även när banorna är hemliga publikt.
  return publicRaceStaffResponse(raceId, async staff =>
    Response.json(await publicResults(db, raceId, { staff }), { headers: { "cache-control": "public, max-age=2, stale-while-revalidate=3" } }));
}

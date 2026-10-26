import { readPublicRunnerControlMap } from "@o-tid/application";
import { db } from "../../../../../../../../lib/db";
import { publicRaceStaffResponse } from "../../../../../../../../lib/public-race-gate";

/**
 * Steg 52 (ADR-0176): löparens bana på kartan ("Visa på kartan" på deltagarsidan). Bara när banorna är publika, eller för
 * arrangören och funktionärerna; inga andra löpares data och ingen belastning.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string; publicResultId: string }> }) {
  const { raceId, publicResultId } = await params;
  return publicRaceStaffResponse(raceId, async staff => {
    const map = await readPublicRunnerControlMap(db, raceId, publicResultId, { staff });
    if (!map) return Response.json({ formatVersion: 1, error: "NOT_FOUND" }, { status: 404, headers: { "cache-control": "no-store" } });
    return Response.json(map, { headers: { "cache-control": "public, max-age=5, stale-while-revalidate=10" } });
  });
}

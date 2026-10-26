import { publicResultDetail } from "@o-tid/application";
import { db } from "../../../../../../../lib/db";
import { cachedPublicResultDetail } from "../../../../../../../lib/public-race-data";
import { PUBLIC_STALE_HEADER } from "../../../../../../../lib/public-stale";
import { publicRaceStaffResponse } from "../../../../../../../lib/public-race-gate";

export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string; publicResultId: string }> }) {
  const { raceId, publicResultId } = await params;
  return publicRaceStaffResponse(raceId, async staff => {
    // Steg 51: raden ur den cachade resultatlistan. Steg 52: arrangören och funktionärerna läser utan cache och ser
    // gafflingsbilden även när banorna är hemliga publikt.
    const detail = staff ? await publicResultDetail(db, raceId, publicResultId, { staff }) : await cachedPublicResultDetail(raceId, publicResultId);
    if (detail.status === "not-found") return Response.json({ formatVersion: 1, error: "NOT_FOUND" }, { status: 404 });
    if ("stale" in detail && detail.stale) return Response.json(detail.response, { headers: { "cache-control": "no-store", [PUBLIC_STALE_HEADER]: "1" } });
    return Response.json(detail.response, { headers: { "cache-control": "public, max-age=2, stale-while-revalidate=3" } });
  });
}

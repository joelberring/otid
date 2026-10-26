import { cachedPublicResultDetail } from "../../../../../../../lib/public-race-data";
import { publicRaceResponse } from "../../../../../../../lib/public-race-gate";

export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string; publicResultId: string }> }) {
  const { raceId, publicResultId } = await params;
  return publicRaceResponse(raceId, async () => {
    // Steg 51: raden ur den cachade resultatlistan, inte en ny uträkning av hela listan för varje deltagarsida.
    const detail = await cachedPublicResultDetail(raceId, publicResultId);
    if (detail.status === "not-found") return Response.json({ formatVersion: 1, error: "NOT_FOUND" }, { status: 404 });
    return Response.json(detail.response, { headers: { "cache-control": "public, max-age=2, stale-while-revalidate=3" } });
  });
}

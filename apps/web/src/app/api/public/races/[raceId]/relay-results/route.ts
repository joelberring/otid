import { publicRelayResults } from "@o-tid/application";
import { db } from "../../../../../../lib/db";
import { publicRaceResponse } from "../../../../../../lib/public-race-gate";

/** Publika stafettresultat: lagresultat och sträckresultat (ADR-0169 beslut 3). */
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, async () =>
    Response.json(await publicRelayResults(db, raceId), { headers: { "cache-control": "public, max-age=2, stale-while-revalidate=3" } }));
}

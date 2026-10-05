import { publicRelayResults } from "@o-tid/application";
import { db } from "../../../../../../lib/db";
import { hiddenRaceResponse } from "../../../../../../lib/public-race-gate";

/** Publika stafettresultat: lagresultat och sträckresultat (ADR-0169 beslut 3). */
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const hidden = await hiddenRaceResponse(raceId);
  if (hidden) return hidden;
  return Response.json(await publicRelayResults(db, raceId), { headers: { "cache-control": "public, max-age=2, stale-while-revalidate=3" } });
}

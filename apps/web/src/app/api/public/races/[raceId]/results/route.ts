import { publicResults } from "@o-tid/application";
import { db } from "../../../../../../lib/db";
import { publicRaceResponse } from "../../../../../../lib/public-race-gate";

export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, async () =>
    Response.json(await publicResults(db, raceId), { headers: { "cache-control": "public, max-age=2, stale-while-revalidate=3" } }));
}

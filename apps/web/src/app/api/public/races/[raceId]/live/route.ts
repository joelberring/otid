import { readPublicLive } from "@o-tid/application";
import { db } from "../../../../../../lib/db";
import { publicRaceResponse } from "../../../../../../lib/public-race-gate";

/** Live för publiken (PLAN.md steg 30): senast i mål, ledare per klass och radiopassager, bakom samma grind som resultaten. */
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, async () =>
    Response.json(await readPublicLive(db, raceId), { headers: { "cache-control": "public, max-age=2, stale-while-revalidate=3" } }));
}

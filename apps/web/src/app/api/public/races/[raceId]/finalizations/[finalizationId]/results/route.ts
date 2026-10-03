import { readPublicFrozenRaceResults } from "@o-tid/application";
import { db } from "../../../../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string; finalizationId: string }> }) {
  const { raceId, finalizationId } = await params;
  const result = await readPublicFrozenRaceResults(db, raceId, finalizationId);
  return result.status === "ok"
    ? Response.json(result.response, { headers: { "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } })
    : new Response(null, { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

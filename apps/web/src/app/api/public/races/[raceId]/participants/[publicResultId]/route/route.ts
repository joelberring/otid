import { readPublicParticipantRoute } from "@o-tid/application";
import { db } from "../../../../../../../../lib/db";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string; publicResultId: string }> }) {
  const { raceId, publicResultId } = await params;
  const result = await readPublicParticipantRoute(db, raceId, publicResultId);
  return result.status === "ok"
    ? Response.json(result.response, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } })
    : new Response(null, { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

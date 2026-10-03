import { readPublicParticipantRouteComparison } from "@o-tid/application";
import { db } from "../../../../../../lib/db";

export const dynamic = "force-dynamic";
const missing = () => new Response(null, { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const url = new URL(request.url);
  const result = await readPublicParticipantRouteComparison(
    db,
    raceId,
    url.searchParams.get("first") ?? "",
    url.searchParams.get("second") ?? "",
    url.searchParams.get("third") ?? undefined
  );
  return result.status === "ok" ? Response.json(result.response, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }) : missing();
}

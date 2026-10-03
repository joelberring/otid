import { readPublicMapMetadata } from "@o-tid/application";
import { db } from "../../../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const result = await readPublicMapMetadata(db, raceId);
  if (result.status === "not-found") return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  return Response.json(result.metadata, { headers: { "cache-control": "no-store" } });
}

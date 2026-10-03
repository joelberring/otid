import { publicResultDetail } from "@o-tid/application";
import { db } from "../../../../../../../lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string; publicResultId: string }> }) {
  const { raceId, publicResultId } = await params;
  const detail = await publicResultDetail(db, raceId, publicResultId);
  if (detail.status === "not-found") return Response.json({ formatVersion: 1, error: "NOT_FOUND" }, { status: 404 });
  return Response.json(detail.response, { headers: { "cache-control": "public, max-age=2, stale-while-revalidate=3" } });
}

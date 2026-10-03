import { publicResults } from "@o-tid/application";
import { db } from "../../../../../../lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return Response.json(await publicResults(db, raceId), { headers: { "cache-control": "public, max-age=2, stale-while-revalidate=3" } });
}

import { db } from "../../../../../lib/db";
import { publicStartListRoute } from "../../../../../lib/public-start-list-route";
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  return publicStartListRoute(db, (await params).raceId);
}

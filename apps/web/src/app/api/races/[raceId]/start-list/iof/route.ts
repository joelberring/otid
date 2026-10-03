import { db } from "../../../../../../lib/db";
import { publicStartListXmlRoute } from "../../../../../../lib/public-start-list-xml-route";
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  return publicStartListXmlRoute(db, (await params).raceId);
}

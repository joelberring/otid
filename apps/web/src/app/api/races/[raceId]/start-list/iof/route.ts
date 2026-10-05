import { db } from "../../../../../../lib/db";
import { publicStartListXmlRoute } from "../../../../../../lib/public-start-list-xml-route";
import { publicRaceResponse } from "../../../../../../lib/public-race-gate";
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, () => publicStartListXmlRoute(db, raceId));
}

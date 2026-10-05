import { db } from "../../../../../../lib/db";
import { publicStartListXmlRoute } from "../../../../../../lib/public-start-list-xml-route";
import { hiddenRaceResponse } from "../../../../../../lib/public-race-gate";
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return await hiddenRaceResponse(raceId) ?? publicStartListXmlRoute(db, raceId);
}

import { raceGroupNameDisplay } from "@o-tid/application";
import { db } from "../../../../../../lib/db";
import { publicStartListXmlRoute } from "../../../../../../lib/public-start-list-xml-route";
import { publicRaceResponse } from "../../../../../../lib/public-race-gate";
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  // Steg 68: IOF XML har alltid hela namnet; en träningsgrupp som döljer namnen har ingen publik IOF-fil.
  return publicRaceResponse(raceId, async () => await raceGroupNameDisplay(db, raceId) === "FULL" ? publicStartListXmlRoute(db, raceId)
    : new Response(null, { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }));
}

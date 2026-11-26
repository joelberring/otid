import { db } from "../../../../../../lib/db";
import { publicRaceResponse } from "../../../../../../lib/public-race-gate";
import { publicRaceMapResponse } from "../../../../../../lib/public-race-map-route";

/**
 * Kartbilden för vägvalen (PLAN.md steg 16), bara när kartan är georefererad. Med rätt version (`?v=`, början av
 * bildens SHA-256) får webbläsaren spara den länge; en ny bild får en ny version.
 */
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return publicRaceResponse(raceId, () => publicRaceMapResponse(db, request, raceId));
}

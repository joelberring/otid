import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

/** Steg 60: GPS-rutternas delar per sträcka på banan för kalibreringen av farterna (utan namn). */
export async function GET(request: Request, context: { params: Promise<{ raceId: string; courseId: string }> }) {
  const { raceId, courseId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "route-choice-calibration", courseId });
}

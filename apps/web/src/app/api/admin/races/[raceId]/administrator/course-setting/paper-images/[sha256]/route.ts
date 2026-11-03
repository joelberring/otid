import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

/** ADR-0197: papperets bild. */
export async function GET(request: Request, context: { params: Promise<{ raceId: string; sha256: string }> }) {
  const { raceId, sha256 } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-paper-image", sha256 });
}

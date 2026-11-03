import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

/** ADR-0197: laddar upp en bild till papperet (PNG eller JPEG, högst 2 MB). */
export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-paper-images" });
}

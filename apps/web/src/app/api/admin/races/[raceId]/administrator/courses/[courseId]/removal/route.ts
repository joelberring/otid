import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

/** Ta bort bana (PLAN.md steg 27). */
export async function POST(request: Request, context: { params: Promise<{ raceId: string; courseId: string }> }) {
  const { raceId, courseId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-removal", courseId });
}

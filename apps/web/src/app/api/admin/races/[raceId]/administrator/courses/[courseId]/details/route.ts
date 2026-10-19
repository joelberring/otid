import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

/** Banans längd och stigning (PLAN.md steg 25). */
export async function POST(request: Request, context: { params: Promise<{ raceId: string; courseId: string }> }) {
  const { raceId, courseId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-details", courseId });
}

import { db } from "../../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../../lib/race-administrator-route-handlers";

/** Steg 65: den färdiga PDF:en (bara admin, aldrig publik). */
export async function GET(request: Request, context: { params: Promise<{ raceId: string; jobId: string }> }) {
  const { raceId, jobId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-print-job-pdf", jobId });
}

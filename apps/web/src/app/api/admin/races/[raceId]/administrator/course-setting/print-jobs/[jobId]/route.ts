import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

/** Steg 65: tar bort ett PDF-jobb (och PDF:en). */
export async function DELETE(request: Request, context: { params: Promise<{ raceId: string; jobId: string }> }) {
  const { raceId, jobId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-print-job", jobId });
}

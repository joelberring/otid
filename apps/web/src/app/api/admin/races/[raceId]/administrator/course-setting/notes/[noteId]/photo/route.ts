import { db } from "../../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../../lib/race-administrator-route-handlers";

/** Steg 66: notisens foto. */
export async function GET(request: Request, context: { params: Promise<{ raceId: string; noteId: string }> }) {
  const { raceId, noteId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-note-photo", noteId });
}

import { db } from "../../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../../lib/race-administrator-route-handlers";

/** Steg 66: svar i notisens tråd. */
export async function POST(request: Request, context: { params: Promise<{ raceId: string; noteId: string }> }) {
  const { raceId, noteId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-note-reply", noteId });
}

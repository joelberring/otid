import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

/** ADR-0181 beslut 8: ta bort notisen med svar och foto (den som skrev den eller den som får ändra). */
export async function DELETE(request: Request, context: { params: Promise<{ raceId: string; noteId: string }> }) {
  const { raceId, noteId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-note", noteId });
}

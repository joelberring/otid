import { db } from "../../../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../../../lib/race-administrator-route-handlers";

/** ADR-0181 beslut 8: ta bort ett svar (den som skrev det eller den som får ändra). */
export async function DELETE(request: Request, context: { params: Promise<{ raceId: string; noteId: string; replyId: string }> }) {
  const { raceId, noteId, replyId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-note-reply-item", noteId, replyId });
}

/** ADR-0214 beslut 9: redigera svarets text (bara den som skrev det). */
export async function PATCH(request: Request, context: { params: Promise<{ raceId: string; noteId: string; replyId: string }> }) {
  const { raceId, noteId, replyId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-note-reply-item", noteId, replyId });
}

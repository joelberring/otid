import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

/** ADR-0197: tar bort en mall ur kontots bibliotek. */
export async function DELETE(request: Request, context: { params: Promise<{ raceId: string; templateId: string }> }) {
  const { raceId, templateId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-paper-library-item", templateId });
}

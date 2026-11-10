import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

type Context = { params: Promise<{ raceId: string; fileId: string }> };

/** Ägaren 2026-11-10: en sparad utskrift – ladda ner eller ta bort. */
export async function GET(request: Request, context: Context) {
  const { raceId, fileId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-print-file", fileId });
}

export async function DELETE(request: Request, context: Context) {
  const { raceId, fileId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-print-file", fileId });
}

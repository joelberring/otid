import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

/** ADR-0175, tillägg 2026-11-21 (b): det som berörs om nycklarna ordnas om eller låset hävs. */
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-fork-letters" });
}

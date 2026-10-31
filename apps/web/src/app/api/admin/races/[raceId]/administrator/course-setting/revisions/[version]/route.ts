import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

/** Steg 62: en tidigare version av banläggningen med dokumentet. */
export async function GET(request: Request, context: { params: Promise<{ raceId: string; version: string }> }) {
  const { raceId, version } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-revision", version: /^[1-9]\d{0,9}$/.test(version) ? Number(version) : 0 });
}

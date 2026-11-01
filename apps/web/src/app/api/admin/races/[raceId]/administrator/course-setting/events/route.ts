import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Steg 66: strömmen till editorn (SSE): ny version, notiser, förslag, arbetssätt och vilka som är inne. */
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-events" });
}

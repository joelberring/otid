import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

/** Steg 52 (ADR-0176): löparens bana på kartan med stämplingarna (deltagarkortet "Visa på kartan"). */
export async function GET(request: Request, context: { params: Promise<{ raceId: string; entryId: string }> }) {
  const { raceId, entryId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "entry-control-map", entryId });
}

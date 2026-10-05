import { db } from "../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../lib/race-administrator-route-handlers";

/** Löparens GPX-rutt: ladda upp (POST) eller ta bort (DELETE). Löparen anges i `x-otid-entry-id`. */
const handle = async (request: Request, context: { params: Promise<{ raceId: string }> }) =>
  raceAdministratorRoute(db, request, (await context.params).raceId, { kind: "participant-route" });
export const POST = handle;
export const DELETE = handle;

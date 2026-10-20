import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

/** PLAN.md steg 29: sök i löpardatabasen (bricka, namn, klubb). Administratören och funktionären. */
export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) {
  return raceAdministratorRoute(db, request, (await context.params).raceId, { kind: "runner-search" });
}

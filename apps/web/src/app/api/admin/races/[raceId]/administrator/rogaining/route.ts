import { db } from "../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../lib/race-administrator-route-handlers";

/** Rogaining (ADR-0170 beslut 5): sparar kontrollernas poäng och klassernas tidsgräns och straff. */
export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "rogaining" });
}

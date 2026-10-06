import { db } from "../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../lib/race-administrator-route-handlers";

/** ADR-0172 beslut 5: radiokontrollernas inställningar och läge (GET) och spara dem (PUT). */
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "radio" });
}

export async function PUT(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "radio" });
}

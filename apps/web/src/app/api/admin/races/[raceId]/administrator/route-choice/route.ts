import { db } from "../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../lib/race-administrator-route-handlers";

/** Steg 60: vägvalsanalysens läge (inställningar, kartfilen, kontrollernas lägen i kartfilens mm och det publicerade). */
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "route-choice" });
}

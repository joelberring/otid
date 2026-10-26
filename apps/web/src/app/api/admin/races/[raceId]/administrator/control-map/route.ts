import { db } from "../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../lib/race-administrator-route-handlers";

/** Steg 52 (ADR-0176): kontrollkartan i arbetsytan (banor, lägen och belastning). */
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "control-map" });
}

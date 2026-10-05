import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

/** Rogaining: beskedet om vad ändrade poäng och regler gör med de avlästa löparnas resultat. */
export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "rogaining-preview" });
}

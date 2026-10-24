import { db } from "../../../../../../lib/db";
import { publicRaceResponse } from "../../../../../../lib/public-race-gate";
import { selfRegistrationInfoRoute, selfRegistrationRoute } from "../../../../../../lib/self-registration-route";

/**
 * Självregistrering på tävlingsdagen (PLAN.md steg 41): om formuläret är öppet, och registreringen. Ingen inloggning. Bakom
 * samma grind som de andra publika API:erna; tjänsten kräver dessutom att tävlingen är publicerad (en förhandsvisning
 * registrerar inget).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, () => selfRegistrationInfoRoute(db, raceId));
}

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, () => selfRegistrationRoute(db, request, raceId));
}

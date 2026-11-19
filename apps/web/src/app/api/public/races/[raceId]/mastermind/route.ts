import { readMastermindStandings } from "@o-tid/application";
import { db } from "../../../../../../lib/db";
import { mastermindStationRoute } from "../../../../../../lib/mastermind-route";
import { publicRaceStaffResponse } from "../../../../../../lib/public-race-gate";

/**
 * Mastermind med kontroller (ADR-0228): den publika ställningen (namn, brickans sista siffror, status, gissningar och tid),
 * bara på träningsdagen. Inga mönster och inga gissningar. Bakom samma grind som de andra publika API:erna.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceStaffResponse(raceId, async staff => {
    const standings = await readMastermindStandings(db, { raceId, staff });
    if (!standings) return Response.json({ formatVersion: 1, error: "NOT_FOUND" }, { status: 404, headers: { "cache-control": "no-store" } });
    return Response.json(standings, { headers: { "cache-control": "no-store" } });
  });
}

/** "Spela på egen dator" (ADR-0228), utan inloggning: datorns egna spel in, träningens inställningar och datorns spel ut. */
export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceStaffResponse(raceId, staff => mastermindStationRoute(db, request, raceId, staff));
}

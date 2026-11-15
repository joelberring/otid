import { readBingoLeaderboard } from "@o-tid/application";
import { db } from "../../../../../../lib/db";
import { publicRaceStaffResponse } from "../../../../../../lib/public-race-gate";
import { bingoProgressRoute } from "../../../../../../lib/bingo-route";

/**
 * Bingons topplista (ADR-0225): namn, antal rutor, tid och sträcka per grupp, bara på träningsdagen. Inga spår. Bakom samma
 * grind som de andra publika API:erna; arrangören och funktionären kan läsa den alla dagar.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceStaffResponse(raceId, async staff => {
    const board = await readBingoLeaderboard(db, { raceId, staff });
    if (!board) return Response.json({ formatVersion: 1, error: "NOT_FOUND" }, { status: 404, headers: { "cache-control": "no-store" } });
    return Response.json(board, { headers: { "cache-control": "no-store" } });
  });
}

/** Löparens läge (ADR-0225), utan inloggning. Kräver exakt Origin; spärr per IP och tävling i tjänsten. */
export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceStaffResponse(raceId, staff => bingoProgressRoute(db, request, raceId, staff));
}

import { eq } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { raceIdForShortCode } from "./public-races";
import { requireRaceRole } from "./race-session";

/**
 * Ägaren 2026-11-15: snabblänken från tävlingssidan (`/t/<kod>` och undersidorna) till arbetsytan. Bara för ett inloggat konto
 * med adminbehörighet på tävlingen, uttrycklig eller via arrangörsklubben (`requireRaceRole`). Alla andra, också okända koder
 * och konton utan roll, får samma tomma svar, så att svaret inte röjer om tävlingen finns eller har administratörer. Webbläsaren
 * hämtar den efter sidan, så att de publika sidorna kan cachas som förut.
 */
export type RaceShortcut = { formatVersion: 1; admin: { raceId: string; bingo: boolean } | null };

export async function readRaceShortcut(db: Database, input: { sessionToken: string | null; code: string }, now = new Date()): Promise<RaceShortcut> {
  const none: RaceShortcut = { formatVersion: 1, admin: null };
  if (!input.sessionToken) return none;
  const raceId = await raceIdForShortCode(db, input.code);
  if (!raceId) return none;
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { raceId, sessionToken: input.sessionToken, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return none;
    const [bingo] = await tx.select({ raceId: schema.bingoRaces.raceId }).from(schema.bingoRaces).where(eq(schema.bingoRaces.raceId, raceId));
    return { formatVersion: 1, admin: { raceId, bingo: !!bingo } };
  });
}

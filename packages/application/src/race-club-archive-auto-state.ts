import { eq, sql } from "drizzle-orm";
import type { RaceClubArchiveView } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

/**
 * Ägaren 2026-11-12 (G (i), ADR-0209 tillägg 2026-11-12): läget för "Lägg i klubbarkivet när träningen är klar" på en
 * tävling (`race_club_archive_auto`, migration 0113). Utan rad, eller med `enabled` null, gäller förvalet: på för en Träning
 * (arrangörsklubbens klubbyta prövas av den som arkiverar). Ägarens beslut gäller träningar; en tävling av annan typ arkiveras
 * automatiskt bara om någon kryssar i rutan.
 */
const auto = schema.raceClubArchiveAutos;
type RaceType = typeof schema.races.$inferSelect.raceType;

export const autoArchiveDefault = (raceType: RaceType) => raceType === "TRAINING";

export async function autoArchiveRow(tx: DbExecutor, raceId: string) {
  const [row] = await tx.select().from(auto).where(eq(auto.raceId, raceId));
  return row;
}

export function autoArchiveView(row: typeof auto.$inferSelect | undefined, raceType: RaceType): NonNullable<RaceClubArchiveView["auto"]> {
  return { enabled: row?.enabled ?? autoArchiveDefault(raceType), explicit: row?.enabled !== null && row?.enabled !== undefined,
    archivedAt: row?.archivedAt?.toISOString() ?? null, problem: row?.problem ?? null };
}

/** Rutan i eller ur (av tävlingens och klubbytans administratör). */
export async function setAutoArchive(tx: DbExecutor, input: { raceId: string; enabled: boolean; actorId: string; now: Date }): Promise<void> {
  await tx.insert(auto).values({ raceId: input.raceId, enabled: input.enabled, setBy: input.actorId, setAt: input.now, updatedAt: input.now })
    .onConflictDoUpdate({ target: auto.raceId, set: { enabled: input.enabled, setBy: input.actorId, setAt: input.now, updatedAt: input.now } });
}

/** Tävlingen har lagts i ett klubbarkiv (för hand eller automatiskt): spärren sätts första gången och ett problem glöms. */
export async function markAutoArchived(tx: DbExecutor, input: { raceId: string; now: Date }): Promise<void> {
  await tx.insert(auto).values({ raceId: input.raceId, archivedAt: input.now, updatedAt: input.now })
    .onConflictDoUpdate({ target: auto.raceId, set: { archivedAt: sql`coalesce(${auto.archivedAt}, ${input.now.toISOString()}::timestamptz)`,
      problem: null, updatedAt: input.now } });
}

/** Varför den automatiska arkiveringen inte gick (visas för administratörerna under Klubben och klubbarkivet). */
export async function recordAutoArchiveProblem(tx: DbExecutor, input: { raceId: string; problem: "NO_ADMIN" | "FAILED"; now: Date }): Promise<void> {
  await tx.insert(auto).values({ raceId: input.raceId, problem: input.problem, updatedAt: input.now })
    .onConflictDoUpdate({ target: auto.raceId, set: { problem: input.problem, updatedAt: input.now } });
}

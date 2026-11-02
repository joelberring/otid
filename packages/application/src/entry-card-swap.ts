import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { assignCard, type LinkedReadout } from "./card-assignment";
import { latestResultReadout } from "./card-reuse";
import { evaluateAndStore, normalizedReadout } from "./result-revisions";
import { loadRaceSnapshot, type DbExecutor } from "./snapshot";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Entry = typeof schema.entries.$inferSelect;

/** Brickans senaste avläsning i loppet (oavsett vem den bedömdes för). */
async function latestReadoutOfCard(tx: DbExecutor, raceId: string, cardNumber: string) {
  const [row] = await tx.select().from(schema.cardReadouts).where(and(eq(schema.cardReadouts.raceId, raceId),
    eq(schema.cardReadouts.cardNumber, cardNumber))).orderBy(desc(schema.cardReadouts.readAt), desc(schema.cardReadouts.id)).limit(1);
  return row;
}

export interface SwappedCards {
  readonly assignmentId: string;
  readonly otherAssignmentId: string;
  readonly linkedReadouts: readonly LinkedReadout[];
  readonly staleResults: { entryId: string; displayName: string }[];
}

/**
 * "Byt bricka med …" (översynen 2026-11-02): två löpare har sprungit med varandras brickor. Båda kopplingarna släpps och
 * byts i samma transaktion. En avläsning som redan gjorts av en bricka räknas om för den som nu har brickan, om den är
 * nyare än det löparen har ett resultat från. En löpare vars resultat bygger på en avläsning av den bricka hen inte längre
 * har, och vars egen bricka inte lästs ut ännu, finns i `staleResults`: resultatet ersätts när hen läses ut.
 * Anroparen har låst båda deltagarna och kontrollerat versionerna.
 */
export async function swapCards(tx: Transaction, input: { raceId: string; entry: Entry; other: Entry; actorAccountId: string;
  mine: { id: string; cardNumber: string }; theirs: { id: string; cardNumber: string } }): Promise<SwappedCards> {
  const { raceId, entry, other, mine, theirs } = input;
  await tx.update(schema.cardAssignments).set({ active: false }).where(inArray(schema.cardAssignments.id, [mine.id, theirs.id]));
  const toMe = await assignCard(tx, { raceId, entryId: entry.id, cardNumber: theirs.cardNumber, releaseCurrent: false });
  const toOther = await assignCard(tx, { raceId, entryId: other.id, cardNumber: mine.cardNumber, releaseCurrent: false });
  await tx.update(schema.entries).set({ version: other.version + 1 }).where(eq(schema.entries.id, other.id));
  const snapshot = await loadRaceSnapshot(tx, raceId);
  const linkedReadouts: LinkedReadout[] = [];
  const staleResults: { entryId: string; displayName: string }[] = [];
  for (const [runner, card] of [[entry, theirs.cardNumber], [other, mine.cardNumber]] as const) {
    const readout = await latestReadoutOfCard(tx, raceId, card);
    const own = await latestResultReadout(tx, runner.id);
    if (readout && runner.teamId === null && own?.id !== readout.id &&
      (!own || own.cardNumber !== card || own.readAt < readout.readAt)) {
      const stored = await evaluateAndStore(tx, snapshot, normalizedReadout(readout), "UNKNOWN_READOUT_RESOLUTION",
        { entryId: runner.id, actorAccountId: input.actorAccountId });
      if (stored.stored && stored.evaluation.status !== "UNKNOWN_CARD") {
        linkedReadouts.push({ entryId: runner.id, readoutId: readout.id, cardNumber: card, readAt: readout.readAt.toISOString(),
          status: stored.evaluation.status, revision: stored.revision.revision });
        continue;
      }
    }
    if (own && own.cardNumber !== card) staleResults.push({ entryId: runner.id, displayName: `${runner.givenName} ${runner.familyName}` });
  }
  return { assignmentId: toMe.assignmentId, otherAssignmentId: toOther.assignmentId, linkedReadouts, staleResults };
}

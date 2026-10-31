import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { ResultNotes } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import { startPunchNote } from "@o-tid/domain";
import type { DbExecutor } from "./snapshot";
import { loadWrongMaps } from "./wrong-map";

/**
 * Arbetsytans anteckningar om löparnas resultat (PLAN.md steg 25): startstämplingen vid lottad start (sen eller tidig
 * start, eller starttid från stämplingen när lottad tid saknas) och diskens orsak. Reglerna finns i domänen
 * (`startPunchNote`); här läses bara fakta: löparens senaste avläsning, klassens startsätt och den lottade tiden.
 * Steg 61: fel karta (`loadWrongMaps`). Visas i avläsningens besked, deltagarkortet och arbetsytans resultatlista, aldrig på
 * publika sidor.
 */
export async function loadResultNotes(tx: DbExecutor, raceId: string, entryIds?: readonly string[]): Promise<Map<string, ResultNotes>> {
  const notes = new Map<string, ResultNotes>();
  if (entryIds !== undefined && entryIds.length === 0) return notes;
  const scope = (column: typeof schema.resultRevisions.entryId | typeof schema.entries.id) =>
    entryIds === undefined ? undefined : inArray(column, [...entryIds]);
  const readouts = await tx.selectDistinctOn([schema.resultRevisions.entryId], { entryId: schema.resultRevisions.entryId,
    startPunchedAt: schema.cardReadouts.startPunchedAt }).from(schema.resultRevisions)
    .innerJoin(schema.cardReadouts, eq(schema.cardReadouts.id, schema.resultRevisions.readoutId))
    .where(and(eq(schema.resultRevisions.raceId, raceId), isNotNull(schema.resultRevisions.readoutId), scope(schema.resultRevisions.entryId)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision));
  const withPunch = readouts.filter((row) => row.startPunchedAt !== null);
  const facts = withPunch.length === 0 ? [] : await tx.select({ id: schema.entries.id, fixedStartTime: schema.entries.fixedStartTime,
    startRule: schema.classes.startRule }).from(schema.entries).innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
    .where(and(eq(schema.entries.raceId, raceId), inArray(schema.entries.id, withPunch.map((row) => row.entryId))));
  const factsById = new Map(facts.map((row) => [row.id, row]));
  for (const row of withPunch) {
    const entry = factsById.get(row.entryId);
    if (!entry) continue;
    const note = startPunchNote({ startRule: entry.startRule, fixedStartTime: entry.fixedStartTime?.toISOString() ?? null,
      startPunchedAt: row.startPunchedAt!.toISOString() });
    if (note) notes.set(row.entryId, { startPunch: note });
  }
  const disqualifications = await tx.selectDistinctOn([schema.resultRevisions.entryId], { entryId: schema.resultRevisions.entryId,
    note: schema.resultRevisions.note }).from(schema.resultRevisions)
    .where(and(eq(schema.resultRevisions.raceId, raceId), eq(schema.resultRevisions.cause, "MANUAL_DISQUALIFICATION"),
      scope(schema.resultRevisions.entryId)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision));
  for (const row of disqualifications) {
    if (row.note) notes.set(row.entryId, { ...notes.get(row.entryId), disqualificationReason: row.note });
  }
  // Steg 61: fel karta – bara för felstämplade (senaste resultatet MP) med tilldelad variant.
  const mispunched = (await tx.selectDistinctOn([schema.resultRevisions.entryId], { entryId: schema.resultRevisions.entryId,
    status: schema.resultRevisions.status }).from(schema.resultRevisions)
    .where(and(eq(schema.resultRevisions.raceId, raceId), eq(schema.resultRevisions.published, true), scope(schema.resultRevisions.entryId)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision))).filter((row) => row.status === "MP");
  for (const [entryId, wrongMap] of await loadWrongMaps(tx, raceId, mispunched.map((row) => row.entryId))) {
    notes.set(entryId, { ...notes.get(entryId), wrongMap: { assignedCode: wrongMap.assignedCode, fittingCodes: [...wrongMap.fittingCodes] } });
  }
  return notes;
}

/** Bara det som gäller det visade resultatet: diskens orsak när löparen är diskad, startstämplingen när resultatet har tid. */
export function applicableResultNotes(notes: ResultNotes | undefined, status: string | undefined): ResultNotes | undefined {
  if (!notes || !status) return undefined;
  const timed = status === "OK" || status === "OVERTIME" || status === "MP" || status === "DSQ" || status === "OOC";
  const value: ResultNotes = { ...(timed && notes.startPunch ? { startPunch: notes.startPunch } : {}),
    ...(status === "DSQ" && notes.disqualificationReason ? { disqualificationReason: notes.disqualificationReason } : {}),
    ...(status === "MP" && notes.wrongMap ? { wrongMap: notes.wrongMap } : {}) };
  return value.startPunch || value.disqualificationReason || value.wrongMap ? value : undefined;
}

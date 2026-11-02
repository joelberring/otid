import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import type { IofEntryListChange } from "@o-tid/contracts";
import type { CourseDataImport, EntryListImport } from "@o-tid/iof-xml";
import { diffCourseFile } from "./course-file-diff";
import { applyCourseFile, assessCourseFile } from "./source-sync-apply";
import type { CourseFileAction, CourseFileProjection, PlannedRow } from "./source-sync-model";
import { loadCurrentState, readOutByClass } from "./source-sync-state";
import type { DbExecutor } from "./snapshot";

/**
 * Direkt import av IOF XML när tävlingen redan har körts (översynen 2026-11-02).
 *
 * - CourseData: när någon har läst ut eller har ett resultat går importen samma väg som "Läs in ny banfil"
 *   (`source-sync-apply.ts`): skillnaderna mot tävlingen, löpare som läst ut behåller sin variant, och resultaten räknas om
 *   i samma transaktion. Ändras någons resultat (godkänd ↔ felstämplad) avvisas importen och administratören hänvisas till
 *   banfilsjämförelsen, där ändringen visas och bekräftas.
 * - EntryList: skillnaderna mot de anmälda (bricka, klass, namn, klubb) tas fram före sparandet. Brickbyten kräver att
 *   administratören bekräftar listan; en ny klass för någon som läst ut och en bricka som en annan löpare har kvar avvisas
 *   med vem det gäller och vad som skiljer.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class CourseFileSyncRequiredError extends Error {
  constructor(readonly issues: readonly string[]) { super("Banfilen ändrar resultat; använd banfilsjämförelsen"); }
}

export class EntryListChangesError extends Error {
  constructor(readonly changes: readonly IofEntryListChange[], readonly blocking: boolean) {
    super(blocking ? "Anmälningslistan krockar med tävlingen" : "Anmälningslistan ändrar brickor och behöver bekräftas");
  }
}

/** Har någon i loppet läst ut eller fått ett resultat? */
export async function raceHasRun(tx: DbExecutor, raceId: string): Promise<boolean> {
  const { rows } = await tx.execute<{ run: boolean }>(sql`select exists (select 1 from card_readout where race_id = ${raceId})
    or exists (select 1 from result_revision where race_id = ${raceId}) as run`);
  return rows[0]?.run === true;
}

const STATUS_TEXT: Record<string, string> = { OK: "godkänd", MP: "felstämplad", OVERTIME: "över maxtid", DNF: "utgått",
  DNS: "ej start", DSQ: "diskad" };

/** CourseData efter avläsning: banfilens väg med `keep` och omräkning. Ger antal omräknade resultat. */
export async function applyCourseDataAfterReadout(tx: DbExecutor, input: { raceId: string; actorAccountId: string | null;
  snapshotVersionAfter: number; now: Date }, parsed: CourseDataImport): Promise<number> {
  const transaction = tx as Transaction;
  const state = await loadCurrentState(transaction, input.raceId);
  const projection: CourseFileProjection = { kind: "COURSE_FILE", data: { courses: parsed.courses, assignments: parsed.assignments,
    legAssignments: parsed.legAssignments, personAssignments: parsed.personAssignments, teamAssignments: parsed.teamAssignments,
    controlPositions: parsed.controlPositions, ...(parsed.controlMapPositions ? { controlMapPositions: parsed.controlMapPositions } : {}),
    ...(parsed.mapScale !== undefined ? { mapScale: parsed.mapScale } : {}), warnings: parsed.warnings } };
  const diff = diffCourseFile(projection, state, readOutByClass(state));
  const rows: PlannedRow<CourseFileAction>[] = diff.rows.filter((planned) => planned.action.type !== "NONE");
  const assessment = await assessCourseFile(transaction, input.raceId, rows, state);
  if (assessment.consequence.requiresConfirmation) {
    const changes = assessment.consequence.changes.slice(0, 40).map((change) =>
      `${change.displayName} (${change.className}): ${STATUS_TEXT[change.before] ?? change.before} → ${STATUS_TEXT[change.after] ?? change.after}`);
    throw new CourseFileSyncRequiredError([
      `Banfilen ändrar resultatet för ${assessment.consequence.changes.length} löpare som redan läst ut. Använd Banor → Läs in ny banfil, ` +
      "som visar skillnaderna och räknar om resultaten när du bekräftar.", ...changes]);
  }
  return applyCourseFile(transaction, { raceId: input.raceId, actorAccountId: input.actorAccountId ?? "", snapshotVersionAfter: input.snapshotVersionAfter,
    now: input.now, state }, projection, rows, diff.links, assessment);
}

/** Skillnaderna mellan anmälningslistan och de anmälda (bara löpare som redan finns, och brickor som andra har). */
export async function entryListChanges(tx: DbExecutor, raceId: string, parsed: EntryListImport): Promise<IofEntryListChange[]> {
  const state = await loadCurrentState(tx as Transaction, raceId);
  const byExternal = new Map(state.entries.filter((entry) => entry.externalSource === "iof" && entry.externalId)
    .map((entry) => [entry.externalId!, entry]));
  const classByExternal = new Map(state.classes.filter((row) => row.externalSource === "iof" && row.externalId)
    .map((row) => [row.externalId!, row]));
  const className = new Map(state.classes.map((row) => [row.id, row.name]));
  const holderOf = new Map(state.entries.filter((entry) => entry.cardNumber).map((entry) => [entry.cardNumber!, entry]));
  // Brickor som släpps av löpare som byter bricka i samma fil (två som bytt med varandra).
  const releasing = new Set(parsed.entries.flatMap((imported) => {
    const entry = byExternal.get(imported.externalId);
    return entry?.cardNumber && imported.cardNumber && entry.cardNumber !== imported.cardNumber ? [entry.cardNumber] : [];
  }));
  const corrected = await correctedEntries(tx, raceId, [...byExternal.values()].map((entry) => entry.id));
  const changes: IofEntryListChange[] = [];
  for (const imported of parsed.entries) {
    const entry = byExternal.get(imported.externalId);
    const name = `${imported.givenName} ${imported.familyName}`;
    const targetClass = classByExternal.get(imported.classExternalId);
    const ran = entry ? entry.readOut || entry.hasResult : false;
    const base = { name, className: targetClass?.name ?? imported.className, readOut: ran };
    if (entry && targetClass && entry.classId !== targetClass.id) {
      changes.push({ ...base, field: "CLASS", from: className.get(entry.classId) ?? null, to: targetClass.name, blocking: ran,
        ...(ran ? { note: "Har läst ut: byt klass i deltagarkortet, som räknar om resultatet." } : {}) });
    }
    if (entry && corrected.has(entry.id) && (entry.givenName !== imported.givenName || entry.familyName !== imported.familyName ||
      entry.organisationName !== (imported.organisationName ?? null))) {
      changes.push({ ...base, field: "NAME", from: `${entry.givenName} ${entry.familyName}`, to: name, blocking: true,
        note: "Namnet är rättat i O-Tid. Rätta namnet i filen eller i deltagarkortet först." });
    }
    if (!imported.cardNumber || entry?.cardNumber === imported.cardNumber) continue;
    const holder = holderOf.get(imported.cardNumber);
    const taken = holder && holder.id !== entry?.id && !releasing.has(imported.cardNumber);
    if (taken) {
      changes.push({ ...base, field: "CARD", from: entry?.cardNumber ?? null, to: imported.cardNumber, blocking: true,
        note: `Brickan används av ${holder.givenName} ${holder.familyName}. Byt bricka för den löparen först.` });
    } else if (entry?.cardNumber) {
      changes.push({ ...base, field: "CARD", from: entry.cardNumber, to: imported.cardNumber, blocking: false,
        ...(ran ? { note: "Har läst ut: resultatet behålls; avläsningen gjordes med den gamla brickan." } : {}) });
    }
  }
  return changes;
}

async function correctedEntries(tx: DbExecutor, raceId: string, entryIds: readonly string[]): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const rows = await tx.selectDistinct({ entryId: schema.entryIdentityChangeRequests.entryId }).from(schema.entryIdentityChangeRequests)
    .where(and(eq(schema.entryIdentityChangeRequests.raceId, raceId), inArray(schema.entryIdentityChangeRequests.entryId, [...entryIds])));
  return new Set(rows.map((row) => row.entryId));
}

/** Avvisar listan när något krockar, och kräver bekräftelse när brickor byts. */
export function assertEntryListChanges(changes: readonly IofEntryListChange[], confirmed: boolean): void {
  if (changes.some((change) => change.blocking)) throw new EntryListChangesError(changes, true);
  if (!confirmed && changes.some((change) => change.field === "CARD")) throw new EntryListChangesError(changes, false);
}

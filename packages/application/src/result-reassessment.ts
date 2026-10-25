import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import {
  courseEditOutcome, evaluateReadoutForEntry, RESULT_ENGINE_VERSION, summarizeCourseEdit,
  type CourseEditOutcome, type EvaluationStatus, type RaceSnapshot
} from "@o-tid/domain";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { appendResultRevision, normalizedReadout } from "./result-revisions";
import { latestResultReadouts, readoutClaims, recalculationReadout } from "./card-reuse";

/**
 * Gemensam omprövning för "Redigera bana" och "Redigera klass" (ADR-0169 beslut 4).
 * Varje avläst löpare i de berörda klasserna prövas mot en föreslagen ögonblicksbild
 * med samma resultatmotor som avläsningen. Efter sparande räknas samma löpare om
 * med nya revisioner; råa avläsningar och äldre revisioner ändras aldrig.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Readout = typeof schema.cardReadouts.$inferSelect;
type Revision = typeof schema.resultRevisions.$inferSelect;
const MAX_ENTRIES = 10_000;

export { normalizedReadout };

export type AssessedEntry = {
  entryId: string; classId: string; displayName: string; className: string; readout: Readout; latest: Revision | null;
  outcome: CourseEditOutcome | "NOT_RECALCULATED"; before: EvaluationStatus; after: EvaluationStatus; recalculate: boolean;
  /** Tiden, sträcktiderna eller statusen blir en annan än nu (PLAN.md steg 31: "hur många påverkas"). */
  changed: boolean;
};

/** Det i en bedömning som en rättning kan ändra: status, tider, sträcktider och saknade kontroller. */
function timingKey(value: unknown): string {
  const row = (value ?? {}) as { status?: unknown; reason?: unknown; startTime?: unknown; finishTime?: unknown; elapsedMs?: unknown;
    missingControls?: unknown; splits?: readonly { controlCode?: unknown; elapsedMs?: unknown }[] };
  const instant = (time: unknown) => typeof time === "string" && Number.isFinite(Date.parse(time)) ? Date.parse(time) : null;
  return JSON.stringify([row.status ?? null, row.reason ?? null, instant(row.startTime), instant(row.finishTime), row.elapsedMs ?? null,
    row.missingControls ?? [], (row.splits ?? []).map(split => [split.controlCode ?? null, split.elapsedMs ?? null])]);
}

/** Prövar varje avläst löpare i klasserna mot den föreslagna ögonblicksbilden. */
export async function assessReadOutEntries(tx: Transaction, raceId: string, classes: readonly { id: string; name: string }[],
  snapshot: RaceSnapshot, proposed: RaceSnapshot): Promise<AssessedEntry[] | "too-large"> {
  const classIds = classes.map(row => row.id);
  if (classIds.length === 0) return [];
  const classNames = new Map(classes.map(row => [row.id, row.name]));
  const entries = await tx.select({ id: schema.entries.id, classId: schema.entries.classId,
    givenName: schema.entries.givenName, familyName: schema.entries.familyName }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), inArray(schema.entries.classId, classIds)))
    .orderBy(asc(schema.entries.familyName), asc(schema.entries.givenName), asc(schema.entries.id)).limit(MAX_ENTRIES + 1);
  if (entries.length > MAX_ENTRIES) return "too-large";
  if (entries.length === 0) return [];
  const entryIds = entries.map(row => row.id);
  const assignments = await tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber })
    .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true),
      inArray(schema.cardAssignments.entryId, entryIds)));
  const cardsByEntry = new Map<string, string[]>();
  for (const row of assignments) cardsByEntry.set(row.entryId, [...cardsByEntry.get(row.entryId) ?? [], row.cardNumber]);
  const cards = [...new Set(assignments.map(row => row.cardNumber))];
  const readouts = cards.length === 0 ? [] : await tx.selectDistinctOn([schema.cardReadouts.cardNumber]).from(schema.cardReadouts)
    .where(and(eq(schema.cardReadouts.raceId, raceId), inArray(schema.cardReadouts.cardNumber, cards)))
    .orderBy(asc(schema.cardReadouts.cardNumber), desc(schema.cardReadouts.readAt), desc(schema.cardReadouts.id));
  const readoutByCard = new Map(readouts.map(row => [row.cardNumber, row]));
  const claims = await readoutClaims(tx, raceId, readouts.map(row => row.id));
  // Steg 31 (B4): resultatet följer avläsningen och deltagaren. Den som har ett resultat räknas om från sin egen
  // avläsning, även om brickan sedan lästs ut för någon annan (lånad bricka) eller flyttats.
  const resultReadouts = await latestResultReadouts(tx, raceId, entryIds);
  const latest = await tx.selectDistinctOn([schema.resultRevisions.entryId]).from(schema.resultRevisions)
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, entryIds)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id));
  const latestByEntry = new Map(latest.map(row => [row.entryId, row]));
  // Löpare med ett avläsningsbaserat resultat; ett manuellt beslut kan ligga överst utan avläsning.
  const technical = new Set((await tx.selectDistinct({ entryId: schema.resultRevisions.entryId }).from(schema.resultRevisions)
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, entryIds),
      isNotNull(schema.resultRevisions.readoutId)))).map(row => row.entryId));
  const stateByEntry = new Map((await resolveStoredResultHeadStates(tx, raceId, latest)).map(state => [state.head.entryId, state]));
  const assessed: AssessedEntry[] = [];
  for (const entry of entries) {
    const entryCards = cardsByEntry.get(entry.id) ?? [];
    const card = entryCards.length === 1 ? entryCards[0]! : undefined;
    const readout = recalculationReadout(entry.id, resultReadouts.get(entry.id), card, card ? readoutByCard.get(card) : undefined, claims);
    if (!readout) continue;
    const head = latestByEntry.get(entry.id) ?? null;
    const state = stateByEntry.get(entry.id);
    const current = evaluateReadoutForEntry(normalizedReadout(readout), snapshot, entry.id);
    const next = evaluateReadoutForEntry(normalizedReadout(readout), proposed, entry.id);
    const before = head?.status === "OK" || head?.status === "MP" ? head.status : current.status;
    const changed = timingKey(current) !== timingKey(next) ||
      (head?.readoutId !== null && head?.readoutId !== undefined && timingKey(head.evaluation) !== timingKey(next));
    const base = { entryId: entry.id, classId: entry.classId, displayName: `${entry.givenName} ${entry.familyName}`,
      className: classNames.get(entry.classId)!, readout, latest: head, before, after: next.status, changed };
    // Manuellt rättad tid finns bara i den rättade revisionen; en omräkning från avläsningen skulle tappa den.
    // Steg 31: rättningen ligger kvar över senare avläsningar, så det gällande beslutet avgör (inte huvudet).
    if (state && (state.governing === "FINISH_TIME" || state.governing === "START_TIME" || state.governing === "MANUAL_TIME")) {
      assessed.push({ ...base, outcome: "NOT_RECALCULATED", recalculate: false }); continue;
    }
    // Ej start gäller löparen oavsett avläsningen och får inte ersättas av en teknisk revision.
    const didNotStart = !state || state.state === "NO_ACTIVE_RESULT" || state.head.cause === "MANUAL_DID_NOT_START" ||
      state.startCheckinDns?.correction === null;
    if (!head || !technical.has(entry.id) || didNotStart || next.entryId !== entry.id || current.entryId !== entry.id) {
      assessed.push({ ...base, outcome: "UNCHANGED", recalculate: false }); continue;
    }
    const manual = ["DSQ", "APPROVAL", "DNF", "OOC", "NT", "CONTROL_APPROVAL", "MP_CONFIRMED"].includes(state.governing);
    assessed.push({ ...base, outcome: courseEditOutcome(before, next.status, manual), recalculate: true });
  }
  return assessed;
}

/** Beskedet i siffror: hur många som läst ut, vilka som byter status och om bekräftelse krävs. */
export function summarizeAssessment(assessed: readonly AssessedEntry[]) {
  const outcomes = assessed.flatMap(row => row.outcome === "NOT_RECALCULATED" ? [] : [row.outcome]);
  const changes = assessed.filter(row => row.outcome === "BECOMES_OK" || row.outcome === "BECOMES_MISPUNCHED");
  return { readOutCount: assessed.length, ...summarizeCourseEdit(outcomes), notRecalculatedCount: assessed.length - outcomes.length,
    changes: changes.map(row => ({ entryId: row.entryId, displayName: row.displayName, className: row.className,
      before: row.before, after: row.after })), requiresConfirmation: changes.length > 0 };
}

/**
 * Räknar om de prövade löparna mot den sparade ögonblicksbilden. Varje ny revision får
 * databasens underlagshash. Bedömningen måste gälla samma deltagare och bana som beskedet
 * (en banversion för alla, eller banversion per klass).
 */
export async function recalculateAssessedEntries(tx: Transaction, input: { raceId: string; assessed: readonly AssessedEntry[];
  snapshot: RaceSnapshot; snapshotVersion: number; courseVersionId: string | ReadonlyMap<string, string> }) {
  const recalculated: { entryId: string; resultRevisionId: string; revision: number }[] = [];
  for (const row of input.assessed.filter(value => value.recalculate)) {
    const evaluation = evaluateReadoutForEntry(normalizedReadout(row.readout), input.snapshot, row.entryId);
    const expectedCourseVersionId = typeof input.courseVersionId === "string" ? input.courseVersionId : input.courseVersionId.get(row.classId);
    if (!expectedCourseVersionId || evaluation.entryId !== row.entryId || evaluation.courseVersionId !== expectedCourseVersionId) {
      throw new Error("Omräkningen gav en annan deltagare eller bana än förhandsbeskedet");
    }
    const created = await appendResultRevision(tx, { raceId: input.raceId, entryId: row.entryId, readoutId: row.readout.id,
      cause: "EXPLICIT_RECALCULATION", outcome: evaluation, engineVersion: RESULT_ENGINE_VERSION,
      snapshotVersion: input.snapshotVersion, courseVersionId: expectedCourseVersionId });
    recalculated.push({ entryId: row.entryId, resultRevisionId: created.id, revision: created.revision });
  }
  return recalculated;
}

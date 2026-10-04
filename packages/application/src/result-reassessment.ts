import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import {
  courseEditOutcome, evaluateCardReadout, RESULT_ENGINE_VERSION, summarizeCourseEdit,
  type CourseEditOutcome, type EvaluationStatus, type NormalizedCardReadout, type RaceSnapshot
} from "@o-tid/domain";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { appliedControlNeutralization } from "./class-control-neutralization";

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

function normalized(readout: Readout): NormalizedCardReadout {
  return { id: readout.id, raceId: readout.raceId, cardNumber: readout.cardNumber,
    ...(readout.startPunchedAt ? { startPunchedAt: readout.startPunchedAt.toISOString() } : {}),
    ...(readout.finishPunchedAt ? { finishPunchedAt: readout.finishPunchedAt.toISOString() } : {}),
    punches: readout.punches, rawMessageId: readout.rawMessageId, readAt: readout.readAt.toISOString() };
}

export type AssessedEntry = {
  entryId: string; displayName: string; className: string; readout: Readout; latest: Revision | null;
  outcome: CourseEditOutcome | "NOT_RECALCULATED"; before: EvaluationStatus; after: EvaluationStatus; recalculate: boolean;
};

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
    const readout = entryCards.length === 1 ? readoutByCard.get(entryCards[0]!) : undefined;
    if (!readout) continue;
    const head = latestByEntry.get(entry.id) ?? null;
    const state = stateByEntry.get(entry.id);
    const current = evaluateCardReadout(normalized(readout), snapshot);
    const next = evaluateCardReadout(normalized(readout), proposed);
    const before = head?.status === "OK" || head?.status === "MP" ? head.status : current.status;
    const base = { entryId: entry.id, displayName: `${entry.givenName} ${entry.familyName}`,
      className: classNames.get(entry.classId)!, readout, latest: head, before, after: next.status };
    // Manuellt rättad tid finns bara i den rättade revisionen; en omräkning från avläsningen skulle tappa den.
    if (head && (head.manualFinishTimeCorrectionId !== null || head.manualPunchStartTimeCorrectionId !== null)) {
      assessed.push({ ...base, outcome: "NOT_RECALCULATED", recalculate: false }); continue;
    }
    // Ej start gäller löparen oavsett avläsningen och får inte ersättas av en teknisk revision.
    const didNotStart = !state || state.state === "NO_ACTIVE_RESULT" || state.head.didNotStartDecisionId !== null ||
      state.startCheckinDns?.correction === null;
    if (!head || !technical.has(entry.id) || didNotStart || next.entryId !== entry.id || current.entryId !== entry.id) {
      assessed.push({ ...base, outcome: "UNCHANGED", recalculate: false }); continue;
    }
    const manual = state.disqualification?.withdrawal === null || state.approval?.withdrawal === null ||
      state.didNotFinish?.withdrawal === null || state.notCompeting?.withdrawal === null || state.withoutTiming?.withdrawal === null;
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
 * databasens underlagshash. Bedömningen måste gälla samma deltagare och bana som beskedet.
 */
export async function recalculateAssessedEntries(tx: Transaction, input: { raceId: string; assessed: readonly AssessedEntry[];
  snapshot: RaceSnapshot; snapshotVersion: number; courseVersionId: string }) {
  const recalculated: { entryId: string; resultRevisionId: string; revision: number }[] = [];
  for (const row of input.assessed.filter(value => value.recalculate)) {
    const evaluation = evaluateCardReadout(normalized(row.readout), input.snapshot);
    if (evaluation.entryId !== row.entryId || evaluation.courseVersionId !== input.courseVersionId) {
      throw new Error("Omräkningen gav en annan deltagare eller bana än förhandsbeskedet");
    }
    const [created] = await tx.insert(schema.resultRevisions).values({ raceId: input.raceId, entryId: row.entryId,
      readoutId: row.readout.id, revision: row.latest!.revision + 1, cause: "EXPLICIT_RECALCULATION", status: evaluation.status,
      reason: evaluation.reason, evaluation, engineVersion: RESULT_ENGINE_VERSION, snapshotVersion: input.snapshotVersion,
      courseVersionId: input.courseVersionId, controlNeutralizationId: appliedControlNeutralization(input.snapshot, evaluation),
      published: true }).returning();
    if (!created) throw new Error("Resultatrevisionen kunde inte sparas");
    recalculated.push({ entryId: row.entryId, resultRevisionId: created.id, revision: created.revision });
  }
  return recalculated;
}

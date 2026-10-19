import { and, eq, max } from "drizzle-orm";
import { schema } from "@o-tid/database";
import {
  evaluateCardReadout, RESULT_ENGINE_VERSION,
  type EvaluationResult, type NormalizedCardReadout, type RaceSnapshot, type ResultOutcome
} from "@o-tid/domain";
import { appliedControlNeutralization } from "./class-control-neutralization";
import type { DbExecutor } from "./snapshot";

/**
 * Det enda stället som skriver `result_revision` (ADR-0173 beslut 4). Revisioner läggs alltid till; nästa
 * revisionsnummer räknas under deltagarradens lås, så samtidig avläsning och omräkning serialiseras per löpare.
 * Databasutlösaren sätter underlagshashen (ADR-0169 beslut 1).
 */
export type ResultRevisionRow = typeof schema.resultRevisions.$inferSelect;
export type ResultRevisionCause = ResultRevisionRow["cause"];
type Readout = typeof schema.cardReadouts.$inferSelect;

export interface AppendResultRevisionInput {
  readonly raceId: string;
  readonly entryId: string;
  readonly cause: ResultRevisionCause;
  readonly outcome: ResultOutcome;
  readonly engineVersion: string;
  readonly snapshotVersion: number;
  readonly courseVersionId: string;
  readonly readoutId?: string | null;
  readonly controlNeutralizationId?: string | null;
  readonly shortenedCourseClassTransferId?: string | null;
  readonly startCheckinDnsDecisionId?: string | null;
  readonly actorAccountId?: string | null;
  readonly requestId?: string | null;
  /** Disk med orsak (PLAN.md steg 25): arrangörens text, bara på MANUAL_DISQUALIFICATION. */
  readonly note?: string | null;
  readonly id?: string;
  readonly createdAt?: Date;
  /** Kräver att revisionen blir exakt detta nummer (anroparen har läst huvudet under samma lås). */
  readonly expectedRevision?: number;
}

/** Låser deltagaren och returnerar nuvarande högsta revisionsnummer (0 utan revision). */
export async function lockResultHead(tx: DbExecutor, raceId: string, entryId: string): Promise<number> {
  const [entry] = await tx.select({ id: schema.entries.id }).from(schema.entries)
    .where(and(eq(schema.entries.id, entryId), eq(schema.entries.raceId, raceId))).for("update");
  if (!entry) throw new Error("Deltagaren finns inte");
  const [head] = await tx.select({ revision: max(schema.resultRevisions.revision) }).from(schema.resultRevisions)
    .where(eq(schema.resultRevisions.entryId, entryId));
  return head?.revision ?? 0;
}

export async function appendResultRevision(tx: DbExecutor, input: AppendResultRevisionInput): Promise<ResultRevisionRow> {
  const revision = await lockResultHead(tx, input.raceId, input.entryId) + 1;
  if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
    throw new Error("Resultatrevisionens nummer ändrades under skrivningen");
  }
  const [created] = await tx.insert(schema.resultRevisions).values({
    ...(input.id ? { id: input.id } : {}),
    raceId: input.raceId,
    entryId: input.entryId,
    readoutId: input.readoutId ?? null,
    revision,
    cause: input.cause,
    status: input.outcome.status,
    reason: input.outcome.reason,
    evaluation: input.outcome,
    engineVersion: input.engineVersion,
    snapshotVersion: input.snapshotVersion,
    courseVersionId: input.courseVersionId,
    controlNeutralizationId: input.controlNeutralizationId ?? null,
    shortenedCourseClassTransferId: input.shortenedCourseClassTransferId ?? null,
    startCheckinDnsDecisionId: input.startCheckinDnsDecisionId ?? null,
    requestId: input.requestId ?? null,
    actorAccountId: input.actorAccountId ?? null,
    note: input.note ?? null,
    published: true,
    ...(input.createdAt ? { createdAt: input.createdAt } : {})
  }).returning();
  if (!created) throw new Error("Resultatrevisionen kunde inte sparas");
  return created;
}

export function normalizedReadout(readout: Readout): NormalizedCardReadout {
  return { id: readout.id, raceId: readout.raceId, cardNumber: readout.cardNumber,
    ...(readout.startPunchedAt ? { startPunchedAt: readout.startPunchedAt.toISOString() } : {}),
    ...(readout.finishPunchedAt ? { finishPunchedAt: readout.finishPunchedAt.toISOString() } : {}),
    punches: readout.punches, rawMessageId: readout.rawMessageId, readAt: readout.readAt.toISOString() };
}

export interface EvaluateAndStoreOptions {
  /** Bedömningen måste gälla denna deltagare (och bana); annars sparas inget. */
  readonly entryId?: string;
  readonly courseVersionId?: string;
  readonly snapshotVersion?: number;
  readonly shortenedCourseClassTransferId?: string;
  readonly actorAccountId?: string | null;
  readonly requestId?: string | null;
}

export type EvaluateAndStoreResult =
  | { readonly stored: true; readonly evaluation: EvaluationResult; readonly revision: ResultRevisionRow }
  | { readonly stored: false; readonly evaluation: EvaluationResult };

/**
 * Bedömer en lagrad avläsning med domänmotorn och lägger till revisionen. Utan känd deltagare och bana
 * (okänd bricka) sparas ingen revision. Med `entryId`/`courseVersionId` kastar en avvikande bedömning.
 */
export async function evaluateAndStore(tx: DbExecutor, snapshot: RaceSnapshot, readout: NormalizedCardReadout,
  cause: ResultRevisionCause, options: EvaluateAndStoreOptions = {}): Promise<EvaluateAndStoreResult> {
  const evaluation = evaluateCardReadout(readout, snapshot);
  if ((options.entryId !== undefined && evaluation.entryId !== options.entryId) ||
    (options.courseVersionId !== undefined && evaluation.courseVersionId !== options.courseVersionId)) {
    throw new Error("Bedömningen gav en annan deltagare eller bana än väntat");
  }
  if (!evaluation.entryId || !evaluation.courseVersionId) return { stored: false, evaluation };
  const revision = await appendResultRevision(tx, { raceId: snapshot.race.id, entryId: evaluation.entryId, cause,
    outcome: evaluation, engineVersion: RESULT_ENGINE_VERSION,
    snapshotVersion: options.snapshotVersion ?? snapshot.race.snapshotVersion, courseVersionId: evaluation.courseVersionId,
    readoutId: readout.id, controlNeutralizationId: appliedControlNeutralization(snapshot, evaluation),
    shortenedCourseClassTransferId: options.shortenedCourseClassTransferId ?? null,
    actorAccountId: options.actorAccountId ?? null, requestId: options.requestId ?? null });
  return { stored: true, evaluation, revision };
}

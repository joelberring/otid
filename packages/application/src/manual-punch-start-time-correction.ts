import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  canonicalJsonBytes,
  manualPunchStartTimeCorrectionCandidateSchema,
  manualPunchStartTimeCorrectionIdempotencyKeySchema,
  manualPunchStartTimeCorrectionRequestSchema,
  manualPunchStartTimeCorrectionResponseSchema,
  type ManualPunchStartTimeCorrectionCandidate,
  type ManualPunchStartTimeCorrectionRequest,
  type ManualPunchStartTimeCorrectionResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { correctPunchedStartTime, type EvaluationResult } from "@o-tid/domain";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockEntryForRevision, lockRaceForMutation } from "./concurrency";
import { loadActiveManualResultOverrideState } from "./result-revision-state";
import {
  parseStrictStoredResultRevision,
  StoredResultRevisionConflict,
  validateStoredManualPunchStartTimeCorrection
} from "./stored-result-revision";
import { isResultCurrent, loadResultBasisHash } from "./result-basis";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENGINE_VERSION = "manual-punch-start-time-correction-v1";
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Correction = typeof schema.manualPunchStartTimeCorrections.$inferSelect;
type Revision = typeof schema.resultRevisions.$inferSelect;

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

function canonicalEquals(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalJsonBytes(left);
  const rightBytes = canonicalJsonBytes(right);
  return leftBytes.length === rightBytes.length && leftBytes.every((value, index) => value === rightBytes[index]);
}

function directTimedOutcome(revision: Revision): EvaluationResult | null {
  const technical = revision.cause === "CARD_READOUT" || revision.cause === "CLASS_CHANGE_RECALCULATION" ||
    revision.cause === "EXPLICIT_RECALCULATION" || revision.cause === "UNKNOWN_READOUT_RESOLUTION";
  if (!technical || !revision.published || revision.readoutId === null) return null;
  const outcome = parseStrictStoredResultRevision(revision);
  if ((outcome.status !== "OK" && outcome.status !== "MP") || !("startTime" in outcome) ||
      !("finishTime" in outcome) || !("elapsedMs" in outcome) || !outcome.startTime || !outcome.finishTime ||
      outcome.elapsedMs === undefined || !Number.isSafeInteger(outcome.elapsedMs)) return null;
  return outcome as EvaluationResult;
}

async function candidateBasis(tx: Transaction, raceId: string, entryId: string): Promise<
  | { status: "not-found" | "conflict" }
  | { status: "ok"; candidate: ManualPunchStartTimeCorrectionCandidate; source: Revision; outcome: EvaluationResult; sourceStartPunchedAt: Date }
> {
  const [[race], [entry]] = await Promise.all([
    tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion }).from(schema.races)
      .where(eq(schema.races.id, raceId)).limit(1),
    tx.select({ id: schema.entries.id, version: schema.entries.version, classId: schema.entries.classId,
      givenName: schema.entries.givenName, familyName: schema.entries.familyName, className: schema.classes.name,
      courseVersionId: schema.classes.courseVersionId, startRule: schema.classes.startRule }).from(schema.entries)
      .innerJoin(schema.classes, and(eq(schema.classes.id, schema.entries.classId), eq(schema.classes.raceId, raceId)))
      .where(and(eq(schema.entries.id, entryId), eq(schema.entries.raceId, raceId))).limit(1)
  ]);
  if (!race || !entry) return { status: "not-found" };
  const [source] = await tx.select().from(schema.resultRevisions).where(and(
    eq(schema.resultRevisions.raceId, raceId), eq(schema.resultRevisions.entryId, entryId)
  )).orderBy(desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id)).limit(1);
  if (!source || entry.startRule !== "PUNCH" || await loadActiveManualResultOverrideState(tx, raceId, source) !== "NONE") {
    return { status: "conflict" };
  }
  let outcome: EvaluationResult | null;
  try { outcome = directTimedOutcome(source); } catch (error) {
    if (error instanceof StoredResultRevisionConflict) return { status: "conflict" };
    throw error;
  }
  const [readout] = source.readoutId === null ? [] : await tx.select({ id: schema.cardReadouts.id,
    startPunchedAt: schema.cardReadouts.startPunchedAt }).from(schema.cardReadouts).where(and(
      eq(schema.cardReadouts.id, source.readoutId), eq(schema.cardReadouts.raceId, raceId)
    )).limit(1);
  if (!outcome || !readout?.startPunchedAt || outcome.entryId !== entry.id || outcome.classId !== entry.classId ||
      outcome.courseVersionId !== entry.courseVersionId ||
      !isResultCurrent(source, await loadResultBasisHash(tx, entry.id), race.snapshotVersion) ||
      readout.startPunchedAt.getTime() !== Date.parse(outcome.startTime!)) return { status: "conflict" };
  const sourceProjection = {
    resultRevisionId: source.id, resultRevision: source.revision, readoutId: source.readoutId!, cause: source.cause,
    courseVersionId: source.courseVersionId, snapshotVersion: source.snapshotVersion, startRule: "PUNCH" as const,
    outcome: { status: outcome.status, reason: outcome.reason } as const, startTime: outcome.startTime!, finishTime: outcome.finishTime!,
    elapsedMs: outcome.elapsedMs!, splits: outcome.splits.map((split) => ({ ...split }))
  };
  const frozenBasis = { raceId, entryId, entryVersion: entry.version, classId: entry.classId,
    snapshotVersion: race.snapshotVersion, source: sourceProjection };
  return { status: "ok", source, outcome, sourceStartPunchedAt: readout.startPunchedAt,
    candidate: manualPunchStartTimeCorrectionCandidateSchema.parse({ formatVersion: 1, raceId, entryId,
      entryName: `${entry.givenName} ${entry.familyName}`, entryVersion: entry.version, classId: entry.classId,
      className: entry.className, snapshotVersion: race.snapshotVersion, basisHash: hash(frozenBasis), source: sourceProjection }) };
}

export type ManualPunchStartTimeCorrectionCandidateResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; response: ManualPunchStartTimeCorrectionCandidate };

export async function previewManualPunchStartTimeCorrectionAsAdministrator(
  db: Database, input: Omit<PairingAdminRequestAuthentication, "capability"> & { entryId: string }, now = new Date()
): Promise<ManualPunchStartTimeCorrectionCandidateResult> {
  if (!UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.entryId)) return { status: "invalid-request" };
  try {
    return await db.transaction(async (tx) => {
      const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability: "MANAGE_RACE" }, now);
      if (auth.status !== "authenticated") return auth;
      const value = await candidateBasis(tx, auth.principal.raceId, input.entryId);
      return value.status === "ok" ? { status: "ok", response: value.candidate } : value;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredResultRevisionConflict) return { status: "conflict" };
    throw error;
  }
}

export type CorrectManualPunchStartTimeInput = Omit<PairingAdminRequestAuthentication, "capability"> & {
  idempotencyKey: string | null;
  request: unknown;
};
export type CorrectManualPunchStartTimeResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "corrected"; response: ManualPunchStartTimeCorrectionResponse };

function exactReplay(row: Correction, actorCredentialId: string, raceId: string, request: ManualPunchStartTimeCorrectionRequest): boolean {
  const storedRequest = manualPunchStartTimeCorrectionRequestSchema.safeParse(row.request);
  const storedResponse = manualPunchStartTimeCorrectionResponseSchema.safeParse(row.response);
  return storedRequest.success && storedResponse.success && row.actorCredentialId === actorCredentialId && row.raceId === raceId &&
    canonicalEquals(storedRequest.data, request) && storedResponse.data.requestId === row.requestId &&
    storedResponse.data.correctionId === row.requestId;
}

export async function correctManualPunchStartTimeAsAdministrator(
  db: Database, input: CorrectManualPunchStartTimeInput, now = new Date()
): Promise<CorrectManualPunchStartTimeResult> {
  const request = manualPunchStartTimeCorrectionRequestSchema.safeParse(input.request);
  const key = manualPunchStartTimeCorrectionIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!request.success || !key.success || key.data !== `manual-punch-start-time-correction:${request.data.requestId}` ||
      !UUID_PATTERN.test(input.raceId)) return { status: "invalid-request" };
  const correctedAt = new Date(now);
  if (!Number.isFinite(correctedAt.getTime())) throw new Error("Rättningstiden är ogiltig");
  const authInput = { ...input, capability: "MANAGE_RACE" as const, requireCsrf: true };
  const preflight = await authenticatePairingAdminSession(db, authInput, correctedAt);
  if (preflight.status !== "authenticated") return preflight;
  try {
    return await db.transaction(async (tx) => {
      const auth = await authenticatePairingAdminSessionForMutation(tx, authInput, correctedAt);
      if (auth.status !== "authenticated") return auth;
      const race = await lockRaceForMutation(tx, auth.principal.raceId);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key.data}, 0))`);
      const [prior] = await tx.select().from(schema.manualPunchStartTimeCorrections)
        .where(eq(schema.manualPunchStartTimeCorrections.requestId, request.data.requestId));
      if (prior) {
        if (!exactReplay(prior, auth.principal.accessCredentialId, race.id, request.data)) return { status: "conflict" };
        const [[source], [corrected], [readout]] = await Promise.all([
          tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, prior.sourceResultRevisionId)),
          tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, prior.createdResultRevisionId)),
          tx.select({ startPunchedAt: schema.cardReadouts.startPunchedAt }).from(schema.cardReadouts)
            .where(eq(schema.cardReadouts.id, prior.sourceReadoutId))
        ]);
        if (!source || !corrected || !readout?.startPunchedAt) throw new Error("Starttidsrättningens revisionskedja saknas");
        validateStoredManualPunchStartTimeCorrection({ correction: prior, source, corrected, sourceStartPunchedAt: readout.startPunchedAt });
        const response = manualPunchStartTimeCorrectionResponseSchema.parse(prior.response);
        return { status: "corrected", response: { ...response, replayed: true } } as const;
      }
      const entry = await lockEntryForRevision(tx, race.id, request.data.entryId);
      if (entry.version !== request.data.expectedEntryVersion || entry.classId !== request.data.expectedClassId ||
          race.snapshotVersion !== request.data.expectedSnapshotVersion) return { status: "conflict" };
      const current = await candidateBasis(tx, race.id, entry.id);
      if (current.status !== "ok" || current.candidate.basisHash !== request.data.expectedBasisHash ||
          current.candidate.source.resultRevisionId !== request.data.expectedSourceResultRevisionId ||
          current.candidate.source.resultRevision !== request.data.expectedSourceResultRevision ||
          current.candidate.source.readoutId !== request.data.expectedReadoutId ||
          current.candidate.source.startTime !== request.data.expectedSourceStartTime ||
          current.candidate.classId !== request.data.expectedClassId ||
          current.candidate.source.courseVersionId !== request.data.expectedCourseVersionId) return { status: "conflict" };
      let outcome: EvaluationResult;
      try { outcome = correctPunchedStartTime(current.outcome as Parameters<typeof correctPunchedStartTime>[0], request.data.correctedStartTime); }
      catch { return { status: "conflict" }; }
      const createdResultRevisionId = randomUUID();
      const createdResultRevision = current.source.revision + 1;
      const response = manualPunchStartTimeCorrectionResponseSchema.parse({ formatVersion: 1, replayed: false,
        requestId: request.data.requestId, correctionId: request.data.requestId, raceId: race.id, entryId: entry.id,
        classId: entry.classId, courseVersionId: current.source.courseVersionId,
        // ADR-0169: källans underlag frystes i tävlingsversionen som rättningen avser.
        sourceSnapshotVersion: race.snapshotVersion, sourceBasisHash: current.candidate.basisHash,
        snapshotVersionAfter: race.snapshotVersion, source: current.candidate.source,
        previousStartTime: current.candidate.source.startTime, correctedStartTime: outcome.startTime,
        elapsedMs: outcome.elapsedMs, createdResultRevisionId, createdResultRevision,
        cause: "MANUAL_PUNCH_START_TIME_CORRECTION", request: request.data, correctedAt: correctedAt.toISOString() });
      await tx.insert(schema.manualPunchStartTimeCorrections).values({ requestId: response.requestId, raceId: race.id,
        entryId: entry.id, actorCredentialId: auth.principal.accessCredentialId, capability: "MANAGE_RACE",
        expectedEntryVersion: request.data.expectedEntryVersion, classId: entry.classId,
        courseVersionId: current.source.courseVersionId, expectedSnapshotVersion: race.snapshotVersion,
        basisHash: current.candidate.basisHash, sourceResultRevisionId: current.source.id,
        sourceResultRevision: current.source.revision, sourceReadoutId: current.source.readoutId!,
        sourceStartTime: new Date(current.candidate.source.startTime), correctedStartTime: new Date(outcome.startTime!),
        createdResultRevisionId, createdResultRevision, request: request.data, response, correctedAt });
      const [created] = await tx.insert(schema.resultRevisions).values({ id: createdResultRevisionId, raceId: race.id,
        entryId: entry.id, readoutId: null, didNotStartDecisionId: null, startCheckinDnsDecisionId: null,
        controlNeutralizationId: current.source.controlNeutralizationId, manualFinishTimeCorrectionId: null,
        manualFinishTimeCorrectionWithdrawalId: null, manualPunchStartTimeCorrectionId: response.correctionId,
        disqualificationDecisionId: null, disqualificationWithdrawalId: null, approvalDecisionId: null,
        approvalWithdrawalId: null, didNotFinishDecisionId: null, didNotFinishWithdrawalId: null,
        notCompetingDecisionId: null, notCompetingWithdrawalId: null, withoutTimingDecisionId: null,
        withoutTimingWithdrawalId: null, revision: createdResultRevision, cause: "MANUAL_PUNCH_START_TIME_CORRECTION",
        status: outcome.status, reason: outcome.reason, evaluation: outcome, engineVersion: ENGINE_VERSION,
        snapshotVersion: current.source.snapshotVersion, courseVersionId: current.source.courseVersionId,
        published: true, createdAt: correctedAt }).returning();
      if (!created) throw new Error("Starttidsrättningens resultatrevision kunde inte sparas");
      await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "result_revision", entityId: created.id,
        action: "MANUAL_PUNCH_START_TIME_CORRECTED", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL",
        actorId: auth.principal.accessCredentialId, requestId: response.requestId,
        before: { resultRevisionId: current.source.id, revision: current.source.revision, startTime: current.candidate.source.startTime },
        after: { correctionId: response.correctionId, resultRevisionId: created.id, revision: created.revision,
          startTime: outcome.startTime, elapsedMs: outcome.elapsedMs, sourceBasisHash: response.sourceBasisHash } });
      return { status: "corrected", response } as const;
    });
  } catch (error) {
    if (error instanceof StoredResultRevisionConflict) return { status: "conflict" };
    throw error;
  }
}

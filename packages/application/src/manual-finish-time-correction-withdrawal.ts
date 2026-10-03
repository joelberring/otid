import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  canonicalJsonBytes,
  manualFinishTimeCorrectionWithdrawalCandidateSchema,
  manualFinishTimeCorrectionWithdrawalIdempotencyKeySchema,
  manualFinishTimeCorrectionWithdrawalRequestSchema,
  manualFinishTimeCorrectionWithdrawalResponseSchema,
  type ManualFinishTimeCorrectionWithdrawalCandidate,
  type ManualFinishTimeCorrectionWithdrawalRequest,
  type ManualFinishTimeCorrectionWithdrawalResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockEntryForRevision, lockRaceForMutation } from "./concurrency";
import { loadActiveManualResultOverrideState } from "./result-revision-state";
import {
  StoredResultRevisionConflict,
  validateStoredManualFinishTimeCorrection,
  validateStoredManualFinishTimeCorrectionWithdrawal
} from "./stored-result-revision";
import { isResultCurrent, loadResultBasisHash } from "./result-basis";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENGINE_VERSION = "manual-finish-time-correction-withdrawal-v1";
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Revision = typeof schema.resultRevisions.$inferSelect;
type Withdrawal = typeof schema.manualFinishTimeCorrectionWithdrawals.$inferSelect;

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}
function canonicalEquals(left: unknown, right: unknown): boolean {
  const a = canonicalJsonBytes(left), b = canonicalJsonBytes(right);
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

async function basis(tx: Transaction, raceId: string, entryId: string): Promise<
  | { status: "not-found" | "conflict" }
  | { status: "ok"; candidate: ManualFinishTimeCorrectionWithdrawalCandidate; correction: typeof schema.manualFinishTimeCorrections.$inferSelect; source: Revision; corrected: Revision }
> {
  const [[race], [entry], [corrected]] = await Promise.all([
    tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion }).from(schema.races).where(eq(schema.races.id, raceId)).limit(1),
    tx.select({ id: schema.entries.id, version: schema.entries.version, classId: schema.entries.classId, givenName: schema.entries.givenName,
      familyName: schema.entries.familyName, className: schema.classes.name, courseVersionId: schema.classes.courseVersionId })
      .from(schema.entries).innerJoin(schema.classes, and(eq(schema.entries.classId, schema.classes.id), eq(schema.classes.raceId, raceId)))
      .where(and(eq(schema.entries.id, entryId), eq(schema.entries.raceId, raceId))).limit(1),
    tx.select().from(schema.resultRevisions).where(and(eq(schema.resultRevisions.raceId, raceId), eq(schema.resultRevisions.entryId, entryId)))
      .orderBy(desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id)).limit(1)
  ]);
  if (!race || !entry || !corrected) return { status: "not-found" };
  if (corrected.cause !== "MANUAL_FINISH_TIME_CORRECTION" || !corrected.manualFinishTimeCorrectionId ||
      await loadActiveManualResultOverrideState(tx, raceId, corrected) !== "NONE") return { status: "conflict" };
  const [correction] = await tx.select().from(schema.manualFinishTimeCorrections)
    .where(eq(schema.manualFinishTimeCorrections.requestId, corrected.manualFinishTimeCorrectionId)).limit(1);
  if (!correction) return { status: "conflict" };
  const [source] = await tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, correction.sourceResultRevisionId)).limit(1);
  const [priorWithdrawal] = await tx.select({ id: schema.manualFinishTimeCorrectionWithdrawals.id })
    .from(schema.manualFinishTimeCorrectionWithdrawals).where(eq(schema.manualFinishTimeCorrectionWithdrawals.correctionId, correction.requestId)).limit(1);
  if (!source || priorWithdrawal) return { status: "conflict" };
  try { validateStoredManualFinishTimeCorrection({ correction, source, corrected }); }
  catch (error) { if (error instanceof StoredResultRevisionConflict) return { status: "conflict" }; throw error; }
  if (source.courseVersionId !== entry.courseVersionId ||
      !isResultCurrent(source, await loadResultBasisHash(tx, entry.id), race.snapshotVersion) ||
      source.entryId !== entry.id || source.revision + 1 !== corrected.revision) return { status: "conflict" };
  const frozen = { raceId, entryId, entryVersion: entry.version, classId: entry.classId, courseVersionId: entry.courseVersionId,
    snapshotVersion: race.snapshotVersion, correctionId: correction.requestId,
    source: { id: source.id, revision: source.revision, finishTime: correction.sourceFinishTime.toISOString() },
    corrected: { id: corrected.id, revision: corrected.revision, finishTime: correction.correctedFinishTime.toISOString() } };
  return { status: "ok", correction, source, corrected, candidate: manualFinishTimeCorrectionWithdrawalCandidateSchema.parse({
    formatVersion: 1, raceId, entryId, entryName: `${entry.givenName} ${entry.familyName}`, entryVersion: entry.version,
    classId: entry.classId, className: entry.className, courseVersionId: entry.courseVersionId, snapshotVersion: race.snapshotVersion,
    basisHash: hash(frozen), correctionId: correction.requestId,
    source: frozen.source, corrected: frozen.corrected, absoluteHead: { id: corrected.id, revision: corrected.revision }
  }) };
}

export type ManualFinishTimeCorrectionWithdrawalCandidateResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; response: ManualFinishTimeCorrectionWithdrawalCandidate };

export async function previewManualFinishTimeCorrectionWithdrawalAsAdministrator(
  db: Database, input: Omit<PairingAdminRequestAuthentication, "capability"> & { entryId: string }, now = new Date()
): Promise<ManualFinishTimeCorrectionWithdrawalCandidateResult> {
  if (!UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.entryId)) return { status: "invalid-request" };
  try { return await db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability: "MANAGE_RACE" }, now);
    if (auth.status !== "authenticated") return auth;
    const value = await basis(tx, auth.principal.raceId, input.entryId);
    return value.status === "ok" ? { status: "ok", response: value.candidate } : value;
  }, { isolationLevel: "repeatable read" }); }
  catch (error) { if (error instanceof StoredResultRevisionConflict) return { status: "conflict" }; throw error; }
}

export type WithdrawManualFinishTimeCorrectionInput = Omit<PairingAdminRequestAuthentication, "capability"> & { idempotencyKey: string | null; request: unknown };
export type WithdrawManualFinishTimeCorrectionResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "withdrawn"; response: ManualFinishTimeCorrectionWithdrawalResponse };

function replayMatches(row: Withdrawal, actorId: string, raceId: string, request: ManualFinishTimeCorrectionWithdrawalRequest): boolean {
  const stored = manualFinishTimeCorrectionWithdrawalRequestSchema.safeParse(row.request);
  return stored.success && row.actorCredentialId === actorId && row.raceId === raceId && canonicalEquals(stored.data, request);
}

export async function withdrawManualFinishTimeCorrectionAsAdministrator(
  db: Database, input: WithdrawManualFinishTimeCorrectionInput, now = new Date()
): Promise<WithdrawManualFinishTimeCorrectionResult> {
  const request = manualFinishTimeCorrectionWithdrawalRequestSchema.safeParse(input.request);
  const key = manualFinishTimeCorrectionWithdrawalIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!request.success || !key.success || key.data !== `manual-finish-time-correction-withdrawal:${request.data.requestId}` || !UUID_PATTERN.test(input.raceId)) return { status: "invalid-request" };
  const withdrawnAt = new Date(now);
  const authInput = { ...input, capability: "MANAGE_RACE" as const, requireCsrf: true };
  const preflight = await authenticatePairingAdminSession(db, authInput, withdrawnAt);
  if (preflight.status !== "authenticated") return preflight;
  try { return await db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authInput, withdrawnAt);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, auth.principal.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key.data}, 0))`);
    const [existing] = await tx.select().from(schema.manualFinishTimeCorrectionWithdrawals).where(eq(schema.manualFinishTimeCorrectionWithdrawals.requestId, request.data.requestId));
    if (existing) {
      if (!replayMatches(existing, auth.principal.accessCredentialId, race.id, request.data)) return { status: "conflict" };
      const [correction, source, corrected, restored] = await Promise.all([
        tx.select().from(schema.manualFinishTimeCorrections).where(eq(schema.manualFinishTimeCorrections.requestId, existing.correctionId)).then((rows) => rows[0]),
        tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, existing.sourceResultRevisionId)).then((rows) => rows[0]),
        tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, existing.correctedResultRevisionId)).then((rows) => rows[0]),
        tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, existing.createdResultRevisionId)).then((rows) => rows[0])
      ]);
      if (!correction || !source || !corrected || !restored) throw new Error("Återtagandets revisionskedja saknas");
      validateStoredManualFinishTimeCorrectionWithdrawal({ withdrawal: existing, correction, source, corrected, restored });
      const response = manualFinishTimeCorrectionWithdrawalResponseSchema.parse(existing.response);
      return { status: "withdrawn", response: { ...response, replayed: true } } as const;
    }
    const entry = await lockEntryForRevision(tx, race.id, request.data.entryId);
    const current = await basis(tx, race.id, entry.id);
    if (entry.version !== request.data.expectedEntryVersion || entry.classId !== request.data.expectedClassId ||
        race.snapshotVersion !== request.data.expectedSnapshotVersion || current.status !== "ok" ||
        current.candidate.basisHash !== request.data.expectedBasisHash || current.candidate.courseVersionId !== request.data.expectedCourseVersionId ||
        current.candidate.correctionId !== request.data.expectedCorrectionId ||
        current.candidate.source.id !== request.data.expectedSource.id || current.candidate.source.revision !== request.data.expectedSource.revision ||
        current.candidate.corrected.id !== request.data.expectedCorrected.id || current.candidate.corrected.revision !== request.data.expectedCorrected.revision ||
        !canonicalEquals(current.candidate.absoluteHead, request.data.expectedAbsoluteHead)) return { status: "conflict" };
    const withdrawalId = randomUUID(), createdId = randomUUID(), createdRevision = current.corrected.revision + 1;
    const response = manualFinishTimeCorrectionWithdrawalResponseSchema.parse({ formatVersion: 1, replayed: false,
      requestId: request.data.requestId, withdrawalId, raceId: race.id, entryId: entry.id, classId: entry.classId,
      courseVersionId: current.source.courseVersionId, snapshotVersion: current.source.snapshotVersion, correctionId: current.correction.requestId,
      source: current.candidate.source, corrected: current.candidate.corrected,
      created: { id: createdId, revision: createdRevision, finishTime: current.candidate.source.finishTime },
      cause: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL", request: request.data, withdrawnAt: withdrawnAt.toISOString() });
    await tx.insert(schema.manualFinishTimeCorrectionWithdrawals).values({ requestId: response.requestId, id: withdrawalId, raceId: race.id,
      entryId: entry.id, actorCredentialId: auth.principal.accessCredentialId, capability: "MANAGE_RACE", expectedEntryVersion: entry.version,
      classId: entry.classId, courseVersionId: current.source.courseVersionId, expectedSnapshotVersion: race.snapshotVersion,
      basisHash: current.candidate.basisHash, correctionId: current.correction.requestId, sourceResultRevisionId: current.source.id,
      sourceResultRevision: current.source.revision, correctedResultRevisionId: current.corrected.id, correctedResultRevision: current.corrected.revision,
      createdResultRevisionId: createdId, createdResultRevision: createdRevision, request: request.data, response, withdrawnAt });
    const [created] = await tx.insert(schema.resultRevisions).values({ id: createdId, raceId: race.id, entryId: entry.id, readoutId: null,
      didNotStartDecisionId: null, startCheckinDnsDecisionId: null, controlNeutralizationId: current.source.controlNeutralizationId,
      manualFinishTimeCorrectionId: null, manualFinishTimeCorrectionWithdrawalId: withdrawalId, disqualificationDecisionId: null,
      disqualificationWithdrawalId: null, approvalDecisionId: null, approvalWithdrawalId: null, didNotFinishDecisionId: null,
      didNotFinishWithdrawalId: null, notCompetingDecisionId: null, notCompetingWithdrawalId: null, withoutTimingDecisionId: null,
      withoutTimingWithdrawalId: null, revision: createdRevision, cause: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL",
      status: current.source.status, reason: current.source.reason, evaluation: current.source.evaluation, engineVersion: ENGINE_VERSION,
      snapshotVersion: current.source.snapshotVersion, courseVersionId: current.source.courseVersionId, published: true, createdAt: withdrawnAt }).returning();
    if (!created) throw new Error("Måltidsrättningens återtagande kunde inte sparas");
    await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "result_revision", entityId: created.id,
      action: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWN", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      requestId: response.requestId, before: { correctionId: current.correction.requestId, correctedResultRevisionId: current.corrected.id },
      after: { withdrawalId, sourceResultRevisionId: current.source.id, resultRevisionId: created.id, revision: created.revision } });
    return { status: "withdrawn", response } as const;
  }); } catch (error) { if (error instanceof StoredResultRevisionConflict) return { status: "conflict" }; throw error; }
}

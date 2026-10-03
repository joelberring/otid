import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  RESULT_APPROVAL_WITHDRAWAL_POLICY_VERSION,
  resultApprovalWithdrawalIdempotencyKeySchema,
  resultApprovalWithdrawalListResponseSchema,
  resultApprovalWithdrawalRequestSchema,
  resultApprovalWithdrawalResponseSchema,
  type ResultApprovalWithdrawalListResponse,
  type ResultApprovalWithdrawalRequest,
  type ResultApprovalWithdrawalResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import {
  parseDisqualifiableTechnicalRevision,
  parseApprovableTechnicalRevision,
  StoredResultRevisionConflict,
  validateStoredApproval,
  validateStoredApprovalWithdrawal
} from "./stored-result-revision";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { isResultCurrent, loadResultBasisHash } from "./result-basis";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_DECISIONS = 10_000;
type Withdrawal = typeof schema.resultApprovalWithdrawals.$inferSelect;
type Revision = typeof schema.resultRevisions.$inferSelect;

function technicalOkOrMp(row: Revision) {
  return parseDisqualifiableTechnicalRevision(row);
}

async function activeDsq(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], raceId: string, entryId: string): Promise<boolean> {
  const decisions = await tx.select({ id: schema.resultDisqualificationDecisions.id }).from(schema.resultDisqualificationDecisions)
    .where(and(eq(schema.resultDisqualificationDecisions.raceId, raceId), eq(schema.resultDisqualificationDecisions.entryId, entryId)));
  if (!decisions.length) return false;
  const withdrawals = await tx.select({ id: schema.resultDisqualificationWithdrawals.disqualificationDecisionId }).from(schema.resultDisqualificationWithdrawals)
    .where(inArray(schema.resultDisqualificationWithdrawals.disqualificationDecisionId, decisions.map((row) => row.id)));
  const ids = new Set(withdrawals.map((row) => row.id));
  return decisions.some((row) => !ids.has(row.id));
}

export type ResultApprovalWithdrawalListResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; response: ResultApprovalWithdrawalListResponse };

export async function listResultApprovalWithdrawalsAsAdmin(db: Database, input: Omit<PairingAdminRequestAuthentication, "capability">, now = new Date()): Promise<ResultApprovalWithdrawalListResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "not-found" };
  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability: "WITHDRAW_RESULT_APPROVAL" }, now);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion }).from(schema.races)
        .where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;
      const [allDecisions, absolute] = await Promise.all([
        tx.select().from(schema.resultApprovalDecisions).where(eq(schema.resultApprovalDecisions.raceId, race.id))
          .orderBy(asc(schema.resultApprovalDecisions.entryId), desc(schema.resultApprovalDecisions.createdResultRevision)).limit(MAX_DECISIONS + 1),
        tx.selectDistinctOn([schema.resultRevisions.entryId]).from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, race.id))
          .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id))
      ]);
      if (allDecisions.length > MAX_DECISIONS) return { status: "conflict" } as const;
      const approvalStates = (await resolveStoredResultHeadStates(tx, race.id, absolute))
        .flatMap((state) => state.approval === null ? [] : [state.approval]);
      const current = approvalStates.map((state) => state.decision);
      const withdrawalByDecision = new Map(approvalStates.flatMap((state) => state.withdrawal === null ? [] : [[state.decision.id, state.withdrawal] as const]));
      const ids = current.flatMap((d) => [d.targetResultRevisionId, d.createdResultRevisionId, ...(withdrawalByDecision.get(d.id) ? [withdrawalByDecision.get(d.id)!.expectedLatestResultRevisionId, withdrawalByDecision.get(d.id)!.restoredFromResultRevisionId, withdrawalByDecision.get(d.id)!.createdResultRevisionId] : [])]);
      const revisions = ids.length ? await tx.select().from(schema.resultRevisions).where(inArray(schema.resultRevisions.id, ids)) : [];
      const byId = new Map(revisions.map((row) => [row.id, row])); const physicalByEntry = new Map(absolute.map((row) => [row.entryId, row]));
      const entryIds = current.map((d) => d.entryId);
      const entries = entryIds.length ? await tx.select({ id: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName, organisationName: schema.entries.organisationName,
        classId: schema.entries.classId, className: schema.classes.name, courseVersionId: schema.classes.courseVersionId, entryVersion: schema.entries.version })
        .from(schema.entries).innerJoin(schema.classes, and(eq(schema.entries.classId, schema.classes.id), eq(schema.classes.raceId, race.id)))
        .where(and(eq(schema.entries.raceId, race.id), inArray(schema.entries.id, entryIds))) : [];
      const entryById = new Map(entries.map((entry) => [entry.id, entry]));
      const parsed = resultApprovalWithdrawalListResponseSchema.safeParse({ formatVersion: 1, raceId: race.id, snapshotVersion: race.snapshotVersion,
        policyVersion: RESULT_APPROVAL_WITHDRAWAL_POLICY_VERSION, entries: current.map((decision) => {
          const target = byId.get(decision.targetResultRevisionId); const approved = byId.get(decision.createdResultRevisionId);
          const entry = entryById.get(decision.entryId); const absoluteHead = physicalByEntry.get(decision.entryId); const withdrawal = withdrawalByDecision.get(decision.id);
          if (!target || !approved || !entry || !absoluteHead) throw new StoredResultRevisionConflict("Godkännandets revisionskedja saknas");
          validateStoredApproval(decision, target, approved);
          let source: Revision; let metadata: unknown = null;
          if (withdrawal) {
            const expectedLatest = byId.get(withdrawal.expectedLatestResultRevisionId);
            source = byId.get(withdrawal.restoredFromResultRevisionId)!; const restoration = byId.get(withdrawal.createdResultRevisionId)!;
            if (!expectedLatest || !source || !restoration) throw new StoredResultRevisionConflict("Återtagandets revisionskedja saknas");
            validateStoredApprovalWithdrawal(withdrawal, decision, expectedLatest, source, restoration);
            metadata = { id: withdrawal.id, restorationResultRevision: { id: restoration.id, revision: restoration.revision }, policyVersion: withdrawal.policyVersion, withdrawnAt: withdrawal.withdrawnAt.toISOString() };
          } else source = absoluteHead.id === approved.id ? target : absoluteHead;
          const outcome = technicalOkOrMp(source);
          return {
            id: entry.id,
            displayName: `${entry.givenName} ${entry.familyName}`,
            organisationName: entry.organisationName,
            classId: entry.classId,
            className: entry.className,
            courseVersionId: entry.courseVersionId,
            entryVersion: entry.entryVersion,
            state: withdrawal ? "WITHDRAWN" : "WITHDRAWABLE",
            resultApprovalDecisionId: decision.id,
            decidedAt: decision.decidedAt.toISOString(),
            targetResultRevision: {
              id: target.id,
              revision: target.revision,
              status: "MP",
              reason: technicalOkOrMp(target).reason
            },
            approvedResultRevision: { id: approved.id, revision: approved.revision },
            absoluteResultRevision: { id: absoluteHead.id, revision: absoluteHead.revision },
            restorationSourceResultRevision: {
              id: source.id,
              revision: source.revision,
              status: outcome.status,
              reason: outcome.reason
            },
            withdrawal: metadata
          };
        }) });
      return parsed.success ? { status: "ok", response: parsed.data } as const : { status: "conflict" } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) { if (error instanceof StoredResultRevisionConflict) return { status: "conflict" }; throw error; }
}

export type WithdrawResultApprovalInput = Omit<PairingAdminRequestAuthentication, "capability"> & { entryId: string; idempotencyKey: string | null; request: unknown };
export type WithdrawResultApprovalResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "withdrawn"; response: ResultApprovalWithdrawalResponse };

function exactReplay(withdrawal: Withdrawal, actorId: string, raceId: string, entryId: string, request: ResultApprovalWithdrawalRequest): boolean {
  return withdrawal.actorCredentialId === actorId && withdrawal.raceId === raceId && withdrawal.entryId === entryId &&
    withdrawal.expectedEntryVersion === request.expectedEntryVersion && withdrawal.expectedClassId === request.expectedClassId &&
    withdrawal.expectedCourseVersionId === request.expectedCourseVersionId && withdrawal.expectedSnapshotVersion === request.expectedSnapshotVersion &&
    withdrawal.approvalDecisionId === request.expectedResultApprovalDecisionId && withdrawal.withdrawnResultRevisionId === request.expectedApprovedResultRevision.id &&
    withdrawal.withdrawnResultRevision === request.expectedApprovedResultRevision.revision && withdrawal.expectedLatestResultRevisionId === request.expectedAbsoluteResultRevision.id &&
    withdrawal.expectedLatestResultRevision === request.expectedAbsoluteResultRevision.revision && withdrawal.restoredFromResultRevisionId === request.expectedRestorationSourceResultRevision.id &&
    withdrawal.restoredFromResultRevision === request.expectedRestorationSourceResultRevision.revision && withdrawal.policyVersion === request.policyVersion;
}

function responseFor(withdrawal: Withdrawal, restoration: Revision, replayed: boolean): ResultApprovalWithdrawalResponse {
  return resultApprovalWithdrawalResponseSchema.parse({ formatVersion: 1, replayed, requestId: withdrawal.requestId, raceId: withdrawal.raceId, entryId: withdrawal.entryId,
    resultApprovalWithdrawalId: withdrawal.id, resultApprovalDecisionId: withdrawal.approvalDecisionId, approvedResultRevisionId: withdrawal.withdrawnResultRevisionId,
    restorationSourceResultRevisionId: withdrawal.restoredFromResultRevisionId, restorationResultRevisionId: restoration.id, revision: restoration.revision,
    cause: restoration.cause, status: restoration.status, reason: restoration.reason, policyVersion: withdrawal.policyVersion, snapshotVersion: restoration.snapshotVersion,
    courseVersionId: restoration.courseVersionId, withdrawnAt: withdrawal.withdrawnAt.toISOString() });
}

export async function withdrawResultApprovalAsAdmin(db: Database, input: WithdrawResultApprovalInput, now = new Date()): Promise<WithdrawResultApprovalResult> {
  const key = resultApprovalWithdrawalIdempotencyKeySchema.safeParse(input.idempotencyKey); const request = resultApprovalWithdrawalRequestSchema.safeParse(input.request);
  if (!key.success || !request.success || !UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.entryId)) return { status: "invalid-request" };
  const requestId = key.data.slice("manual-result-approval-withdrawal:".length); const withdrawnAt = new Date(now);
  if (!Number.isFinite(withdrawnAt.getTime())) throw new Error("Återtagandetiden är ogiltig");
  const preflight = await authenticatePairingAdminSession(db, { ...input, capability: "WITHDRAW_RESULT_APPROVAL", requireCsrf: true }, withdrawnAt);
  if (preflight.status !== "authenticated") return preflight;
  try { return await db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability: "WITHDRAW_RESULT_APPROVAL", requireCsrf: true }, withdrawnAt);
    if (authorization.status !== "authenticated") return authorization;
    const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion }).from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
    if (!race) return { status: "not-found" } as const;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.resultApprovalWithdrawals).where(eq(schema.resultApprovalWithdrawals.requestId, requestId));
    if (existing) {
      if (!exactReplay(existing, authorization.principal.accessCredentialId, race.id, input.entryId, request.data)) return { status: "conflict" } as const;
      const [decision, absolute, source, restoration] = await Promise.all([
        tx.select().from(schema.resultApprovalDecisions).where(eq(schema.resultApprovalDecisions.id, existing.approvalDecisionId)).then((rows) => rows[0]),
        tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, existing.expectedLatestResultRevisionId)).then((rows) => rows[0]),
        tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, existing.restoredFromResultRevisionId)).then((rows) => rows[0]),
        tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, existing.createdResultRevisionId)).then((rows) => rows[0])
      ]);
      if (!decision || !absolute || !source || !restoration) throw new Error("Återtagandets revisionskedja saknas");
      const target = await tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, decision.targetResultRevisionId)).then((rows) => rows[0]);
      if (!target || parseApprovableTechnicalRevision(target).reason !== request.data.expectedTargetResultRevision.reason ||
          technicalOkOrMp(source).status !== request.data.expectedRestorationSourceResultRevision.status ||
          technicalOkOrMp(source).reason !== request.data.expectedRestorationSourceResultRevision.reason) return { status: "conflict" } as const;
      validateStoredApprovalWithdrawal(existing, decision, absolute, source, restoration);
      return { status: "withdrawn", response: responseFor(existing, restoration, true) } as const;
    }
    const [entry] = await tx.select().from(schema.entries).where(and(eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, race.id))).for("update");
    if (!entry) return { status: "not-found" } as const;
    if (entry.version !== request.data.expectedEntryVersion || entry.classId !== request.data.expectedClassId || race.snapshotVersion !== request.data.expectedSnapshotVersion ||
        request.data.policyVersion !== RESULT_APPROVAL_WITHDRAWAL_POLICY_VERSION || await activeDsq(tx, race.id, entry.id)) return { status: "conflict" } as const;
    const [raceClass] = await tx.select({ courseVersionId: schema.classes.courseVersionId }).from(schema.classes).where(and(eq(schema.classes.id, entry.classId), eq(schema.classes.raceId, race.id)));
    if (!raceClass || raceClass.courseVersionId !== request.data.expectedCourseVersionId) return { status: "conflict" } as const;
    const [decision] = await tx.select().from(schema.resultApprovalDecisions).where(and(eq(schema.resultApprovalDecisions.id, request.data.expectedResultApprovalDecisionId), eq(schema.resultApprovalDecisions.raceId, race.id), eq(schema.resultApprovalDecisions.entryId, entry.id)));
    if (!decision || decision.targetResultRevisionId !== request.data.expectedTargetResultRevision.id || decision.targetResultRevision !== request.data.expectedTargetResultRevision.revision ||
        decision.createdResultRevisionId !== request.data.expectedApprovedResultRevision.id || decision.createdResultRevision !== request.data.expectedApprovedResultRevision.revision) return { status: "conflict" } as const;
    const [closed] = await tx.select({ id: schema.resultApprovalWithdrawals.id }).from(schema.resultApprovalWithdrawals).where(eq(schema.resultApprovalWithdrawals.approvalDecisionId, decision.id));
    if (closed) return { status: "conflict" } as const;
    const [target, approved, latest] = await Promise.all([
      tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, decision.targetResultRevisionId)).then((rows) => rows[0]),
      tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, decision.createdResultRevisionId)).then((rows) => rows[0]),
      tx.select().from(schema.resultRevisions).where(and(eq(schema.resultRevisions.raceId, race.id), eq(schema.resultRevisions.entryId, entry.id))).orderBy(desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id)).limit(1).then((rows) => rows[0])
    ]);
    if (!target || !approved || !latest) return { status: "conflict" } as const;
    validateStoredApproval(decision, target, approved);
    if (parseApprovableTechnicalRevision(target).reason !== request.data.expectedTargetResultRevision.reason) return { status: "conflict" } as const;
    if (latest.id !== request.data.expectedAbsoluteResultRevision.id || latest.revision !== request.data.expectedAbsoluteResultRevision.revision) return { status: "conflict" } as const;
    const source = latest.id === approved.id ? target : latest; const outcome = technicalOkOrMp(source);
    if (source.id !== request.data.expectedRestorationSourceResultRevision.id || source.revision !== request.data.expectedRestorationSourceResultRevision.revision ||
        outcome.status !== request.data.expectedRestorationSourceResultRevision.status || outcome.reason !== request.data.expectedRestorationSourceResultRevision.reason ||
        outcome.classId !== entry.classId || outcome.courseVersionId !== raceClass.courseVersionId ||
        !isResultCurrent(source, await loadResultBasisHash(tx, entry.id), race.snapshotVersion)) return { status: "conflict" } as const;
    const withdrawalId = randomUUID(); const resultRevisionId = randomUUID(); const createdRevision = latest.revision + 1;
    const [withdrawal] = await tx.insert(schema.resultApprovalWithdrawals).values({ id: withdrawalId, requestId, actorCredentialId: authorization.principal.accessCredentialId,
      raceId: race.id, entryId: entry.id, expectedEntryVersion: request.data.expectedEntryVersion, expectedClassId: request.data.expectedClassId, expectedCourseVersionId: request.data.expectedCourseVersionId,
      expectedSnapshotVersion: request.data.expectedSnapshotVersion, approvalDecisionId: decision.id, withdrawnResultRevisionId: approved.id, withdrawnResultRevision: approved.revision,
      expectedLatestResultRevisionId: latest.id, expectedLatestResultRevision: latest.revision, restoredFromResultRevisionId: source.id, restoredFromResultRevision: source.revision,
      policyVersion: request.data.policyVersion, reason: "ERRONEOUS_MANUAL_APPROVAL", createdResultRevisionId: resultRevisionId, createdResultRevision: createdRevision, withdrawnAt }).returning();
    if (!withdrawal) throw new Error("Godkännandeåtertagandet kunde inte sparas");
    const [restoration] = await tx.insert(schema.resultRevisions).values({ id: resultRevisionId, raceId: race.id, entryId: entry.id, readoutId: null, didNotStartDecisionId: null,
      disqualificationDecisionId: null, disqualificationWithdrawalId: null, approvalDecisionId: null, approvalWithdrawalId: withdrawal.id, revision: createdRevision,
      cause: "MANUAL_RESULT_APPROVAL_WITHDRAWAL", status: outcome.status, reason: outcome.reason, evaluation: outcome, engineVersion: RESULT_APPROVAL_WITHDRAWAL_POLICY_VERSION,
      snapshotVersion: race.snapshotVersion, courseVersionId: source.courseVersionId, controlNeutralizationId: source.controlNeutralizationId, published: true, createdAt: withdrawnAt }).returning();
    if (!restoration) throw new Error("Återtagandets restaureringsrevision kunde inte sparas");
    await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "result_revision", entityId: restoration.id, action: "RESULT_APPROVAL_WITHDRAWN",
      actorKind: authorization.principal.capability === "MANAGE_RACE"
        ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "RESULT_APPROVAL_WITHDRAWAL_ACCESS_CREDENTIAL", actorId: authorization.principal.accessCredentialId, requestId,
      before: { resultApprovalDecisionId: decision.id, approvedResultRevisionId: approved.id, absoluteResultRevisionId: latest.id, restorationSourceResultRevisionId: source.id },
      after: { resultApprovalWithdrawalId: withdrawal.id, resultRevisionId: restoration.id, revision: restoration.revision, status: restoration.status, reason: restoration.reason,
        policyVersion: withdrawal.policyVersion, snapshotVersion: restoration.snapshotVersion, courseVersionId: restoration.courseVersionId } });
    return { status: "withdrawn", response: responseFor(withdrawal, restoration, false) } as const;
  }); } catch (error) { if (error instanceof StoredResultRevisionConflict) return { status: "conflict" }; throw error; }
}

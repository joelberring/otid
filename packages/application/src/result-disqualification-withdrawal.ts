import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  RESULT_DISQUALIFICATION_WITHDRAWAL_POLICY_VERSION,
  resultDisqualificationWithdrawalIdempotencyKeySchema,
  resultDisqualificationWithdrawalListResponseSchema,
  resultDisqualificationWithdrawalRequestSchema,
  resultDisqualificationWithdrawalResponseSchema,
  type ResultDisqualificationWithdrawalListResponse,
  type ResultDisqualificationWithdrawalRequest,
  type ResultDisqualificationWithdrawalResponse
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
  StoredResultRevisionConflict,
  parseDisqualifiableTechnicalRevision,
  validateStoredDisqualification,
  validateStoredDisqualificationWithdrawal
} from "./stored-result-revision";
import { isResultCurrent, loadResultBasisHash, loadResultBasisHashes } from "./result-basis";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_DECISIONS = 10_000;

type Decision = typeof schema.resultDisqualificationDecisions.$inferSelect;
type Withdrawal = typeof schema.resultDisqualificationWithdrawals.$inferSelect;
type Revision = typeof schema.resultRevisions.$inferSelect;

export type ResultDisqualificationWithdrawalListResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; response: ResultDisqualificationWithdrawalListResponse };

export async function listResultDisqualificationWithdrawalsAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability">,
  now = new Date()
): Promise<ResultDisqualificationWithdrawalListResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "not-found" };
  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
        ...input,
        capability: "WITHDRAW_DISQUALIFICATION"
      }, now);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
        .from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;

      const [allDecisions, allWithdrawals, absoluteRows] = await Promise.all([
        tx.select().from(schema.resultDisqualificationDecisions)
          .where(eq(schema.resultDisqualificationDecisions.raceId, race.id))
          .orderBy(asc(schema.resultDisqualificationDecisions.entryId), desc(schema.resultDisqualificationDecisions.createdResultRevision))
          .limit(MAX_DECISIONS + 1),
        tx.select().from(schema.resultDisqualificationWithdrawals)
          .where(eq(schema.resultDisqualificationWithdrawals.raceId, race.id)),
        tx.selectDistinctOn([schema.resultRevisions.entryId]).from(schema.resultRevisions)
          .where(eq(schema.resultRevisions.raceId, race.id))
          .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id))
      ]);
      if (allDecisions.length > MAX_DECISIONS) return { status: "conflict" } as const;
      const latestDecisionByEntry = new Map<string, Decision>();
      for (const decision of allDecisions) {
        if (!latestDecisionByEntry.has(decision.entryId)) latestDecisionByEntry.set(decision.entryId, decision);
      }
      const decisions = [...latestDecisionByEntry.values()];
      const withdrawalByDecision = new Map(allWithdrawals.map((row) => [row.disqualificationDecisionId, row]));
      if (withdrawalByDecision.size !== allWithdrawals.length) {
        throw new StoredResultRevisionConflict("Diskvalifikationsbeslutet har flera återtaganden");
      }
      const revisionIds = decisions.flatMap((decision) => {
        const withdrawal = withdrawalByDecision.get(decision.id);
        return [
          decision.targetResultRevisionId,
          decision.createdResultRevisionId,
          ...(withdrawal ? [withdrawal.restoredFromResultRevisionId, withdrawal.createdResultRevisionId] : [])
        ];
      });
      const revisions = revisionIds.length === 0 ? [] : await tx.select().from(schema.resultRevisions)
        .where(inArray(schema.resultRevisions.id, revisionIds));
      const revisionById = new Map(revisions.map((row) => [row.id, row]));
      const absoluteByEntry = new Map(absoluteRows.map((row) => [row.entryId, row]));
      const entryIds = decisions.map((decision) => decision.entryId);
      const entries = entryIds.length === 0 ? [] : await tx.select({
        id: schema.entries.id,
        givenName: schema.entries.givenName,
        familyName: schema.entries.familyName,
        organisationName: schema.entries.organisationName,
        classId: schema.entries.classId,
        className: schema.classes.name,
        courseVersionId: schema.classes.courseVersionId,
        entryVersion: schema.entries.version
      }).from(schema.entries)
        .innerJoin(schema.classes, and(
          eq(schema.entries.classId, schema.classes.id),
          eq(schema.classes.raceId, race.id)
        ))
        .where(and(eq(schema.entries.raceId, race.id), inArray(schema.entries.id, entryIds)));
      const entryById = new Map(entries.map((entry) => [entry.id, entry]));
      const basisHashes = await loadResultBasisHashes(tx, race.id);
      if (entryById.size !== decisions.length) {
        throw new StoredResultRevisionConflict("Diskvalifikationens aktuella deltagare eller klass saknas");
      }

      const parsed = resultDisqualificationWithdrawalListResponseSchema.safeParse({
        formatVersion: 1,
        raceId: race.id,
        snapshotVersion: race.snapshotVersion,
        policyVersion: RESULT_DISQUALIFICATION_WITHDRAWAL_POLICY_VERSION,
        entries: decisions.map((decision) => {
          const entry = entryById.get(decision.entryId);
          const target = revisionById.get(decision.targetResultRevisionId);
          const disqualified = revisionById.get(decision.createdResultRevisionId);
          const absolute = absoluteByEntry.get(decision.entryId);
          if (!entry || !target || !disqualified || !absolute) {
            throw new StoredResultRevisionConflict("Diskvalifikationens revisionskedja saknas");
          }
          validateStoredDisqualification(decision, target, disqualified);
          const withdrawal = withdrawalByDecision.get(decision.id);
          let source: Revision;
          let withdrawalMetadata: null | {
            id: string;
            restorationResultRevision: { id: string; revision: number };
            policyVersion: string;
            withdrawnAt: string;
          } = null;
          if (withdrawal) {
            const storedSource = revisionById.get(withdrawal.restoredFromResultRevisionId);
            const restored = revisionById.get(withdrawal.createdResultRevisionId);
            if (!storedSource || !restored) {
              throw new StoredResultRevisionConflict("Återtagandets revisionskedja saknas");
            }
            validateStoredDisqualificationWithdrawal(withdrawal, decision, storedSource, restored);
            source = storedSource;
            withdrawalMetadata = {
              id: withdrawal.id,
              restorationResultRevision: { id: restored.id, revision: restored.revision },
              policyVersion: withdrawal.policyVersion,
              withdrawnAt: withdrawal.withdrawnAt.toISOString()
            };
          } else {
            source = absolute.id === disqualified.id ? target : absolute;
          }
          const outcome = parseDisqualifiableTechnicalRevision(source);
          if (!withdrawal && (
            entry.classId !== outcome.classId || entry.courseVersionId !== outcome.courseVersionId ||
            !isResultCurrent(source, basisHashes.get(entry.id), race.snapshotVersion)
          )) {
            throw new StoredResultRevisionConflict("Återtagandets restaureringskälla är inaktuell");
          }
          return {
            id: entry.id,
            displayName: `${entry.givenName} ${entry.familyName}`,
            organisationName: entry.organisationName,
            classId: entry.classId,
            className: entry.className,
            courseVersionId: entry.courseVersionId,
            entryVersion: entry.entryVersion,
            state: withdrawal ? "WITHDRAWN" : "WITHDRAWABLE",
            resultDisqualificationDecisionId: decision.id,
            decidedAt: decision.decidedAt.toISOString(),
            targetResultRevision: { id: target.id, revision: target.revision },
            disqualifiedResultRevision: { id: disqualified.id, revision: disqualified.revision },
            absoluteResultRevision: { id: absolute.id, revision: absolute.revision },
            restorationSourceResultRevision: {
              id: source.id,
              revision: source.revision,
              status: outcome.status,
              reason: outcome.reason
            },
            withdrawal: withdrawalMetadata
          };
        })
      });
      return parsed.success ? { status: "ok", response: parsed.data } as const : { status: "conflict" } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredResultRevisionConflict) return { status: "conflict" };
    throw error;
  }
}

export type WithdrawResultDisqualificationInput = Omit<PairingAdminRequestAuthentication, "capability"> & {
  entryId: string;
  idempotencyKey: string | null;
  request: unknown;
};

export type WithdrawResultDisqualificationResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "withdrawn"; response: ResultDisqualificationWithdrawalResponse };

function exactReplay(
  withdrawal: Withdrawal,
  actorCredentialId: string,
  raceId: string,
  entryId: string,
  request: ResultDisqualificationWithdrawalRequest
): boolean {
  return withdrawal.actorCredentialId === actorCredentialId && withdrawal.raceId === raceId &&
    withdrawal.entryId === entryId && withdrawal.expectedEntryVersion === request.expectedEntryVersion &&
    withdrawal.expectedClassId === request.expectedClassId &&
    withdrawal.expectedCourseVersionId === request.expectedCourseVersionId &&
    withdrawal.expectedSnapshotVersion === request.expectedSnapshotVersion &&
    withdrawal.disqualificationDecisionId === request.expectedResultDisqualificationDecisionId &&
    withdrawal.withdrawnResultRevisionId === request.expectedDisqualifiedResultRevision.id &&
    withdrawal.withdrawnResultRevision === request.expectedDisqualifiedResultRevision.revision &&
    withdrawal.expectedLatestResultRevisionId === request.expectedAbsoluteResultRevision.id &&
    withdrawal.expectedLatestResultRevision === request.expectedAbsoluteResultRevision.revision &&
    withdrawal.restoredFromResultRevisionId === request.expectedRestorationSourceResultRevision.id &&
    withdrawal.restoredFromResultRevision === request.expectedRestorationSourceResultRevision.revision &&
    withdrawal.policyVersion === request.policyVersion;
}

function responseFor(
  withdrawal: Withdrawal,
  restoration: Revision,
  replayed: boolean
): ResultDisqualificationWithdrawalResponse {
  return resultDisqualificationWithdrawalResponseSchema.parse({
    formatVersion: 1,
    replayed,
    requestId: withdrawal.requestId,
    raceId: withdrawal.raceId,
    entryId: withdrawal.entryId,
    resultDisqualificationWithdrawalId: withdrawal.id,
    resultDisqualificationDecisionId: withdrawal.disqualificationDecisionId,
    disqualifiedResultRevisionId: withdrawal.withdrawnResultRevisionId,
    restorationSourceResultRevisionId: withdrawal.restoredFromResultRevisionId,
    restorationResultRevisionId: restoration.id,
    revision: restoration.revision,
    cause: restoration.cause,
    status: restoration.status,
    reason: restoration.reason,
    policyVersion: withdrawal.policyVersion,
    snapshotVersion: restoration.snapshotVersion,
    courseVersionId: restoration.courseVersionId,
    withdrawnAt: withdrawal.withdrawnAt.toISOString()
  });
}

export async function withdrawResultDisqualificationAsAdmin(
  db: Database,
  input: WithdrawResultDisqualificationInput,
  now = new Date()
): Promise<WithdrawResultDisqualificationResult> {
  const key = resultDisqualificationWithdrawalIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = resultDisqualificationWithdrawalRequestSchema.safeParse(input.request);
  if (!key.success || !request.success || !UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.entryId)) {
    return { status: "invalid-request" };
  }
  const requestId = key.data.slice("manual-disqualification-withdrawal:".length);
  const withdrawnAt = new Date(now);
  if (!Number.isFinite(withdrawnAt.getTime())) throw new Error("Återtagandetiden är ogiltig");
  const preflight = await authenticatePairingAdminSession(db, {
    ...input,
    capability: "WITHDRAW_DISQUALIFICATION",
    requireCsrf: true
  }, withdrawnAt);
  if (preflight.status !== "authenticated") return preflight;

  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForMutation(tx, {
        ...input,
        capability: "WITHDRAW_DISQUALIFICATION",
        requireCsrf: true
      }, withdrawnAt);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
        .from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);

      const [existing] = await tx.select().from(schema.resultDisqualificationWithdrawals)
        .where(eq(schema.resultDisqualificationWithdrawals.requestId, requestId));
      if (existing) {
        if (!exactReplay(existing, authorization.principal.accessCredentialId, race.id, input.entryId, request.data)) {
          return { status: "conflict" } as const;
        }
        const [decision, source, restoration] = await Promise.all([
          tx.select().from(schema.resultDisqualificationDecisions)
            .where(eq(schema.resultDisqualificationDecisions.id, existing.disqualificationDecisionId)).then((rows) => rows[0]),
          tx.select().from(schema.resultRevisions)
            .where(eq(schema.resultRevisions.id, existing.restoredFromResultRevisionId)).then((rows) => rows[0]),
          tx.select().from(schema.resultRevisions)
            .where(eq(schema.resultRevisions.id, existing.createdResultRevisionId)).then((rows) => rows[0])
        ]);
        if (!decision || !source || !restoration) throw new Error("Återtagandets revisionskedja saknas");
        validateStoredDisqualificationWithdrawal(existing, decision, source, restoration);
        return { status: "withdrawn", response: responseFor(existing, restoration, true) } as const;
      }

      const [entry] = await tx.select().from(schema.entries).where(and(
        eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, race.id)
      )).for("update");
      if (!entry) return { status: "not-found" } as const;
      if (entry.version !== request.data.expectedEntryVersion || entry.classId !== request.data.expectedClassId ||
          race.snapshotVersion !== request.data.expectedSnapshotVersion ||
          request.data.policyVersion !== RESULT_DISQUALIFICATION_WITHDRAWAL_POLICY_VERSION) {
        return { status: "conflict" } as const;
      }
      const [raceClass] = await tx.select({ id: schema.classes.id, courseVersionId: schema.classes.courseVersionId })
        .from(schema.classes).where(and(eq(schema.classes.id, entry.classId), eq(schema.classes.raceId, race.id)));
      if (!raceClass || raceClass.courseVersionId !== request.data.expectedCourseVersionId) {
        return { status: "conflict" } as const;
      }
      const [decision] = await tx.select().from(schema.resultDisqualificationDecisions).where(and(
        eq(schema.resultDisqualificationDecisions.id, request.data.expectedResultDisqualificationDecisionId),
        eq(schema.resultDisqualificationDecisions.raceId, race.id),
        eq(schema.resultDisqualificationDecisions.entryId, entry.id)
      ));
      if (!decision || decision.targetResultRevisionId !== request.data.expectedTargetResultRevision.id ||
          decision.targetResultRevision !== request.data.expectedTargetResultRevision.revision ||
          decision.createdResultRevisionId !== request.data.expectedDisqualifiedResultRevision.id ||
          decision.createdResultRevision !== request.data.expectedDisqualifiedResultRevision.revision) {
        return { status: "conflict" } as const;
      }
      const [alreadyWithdrawn] = await tx.select({ id: schema.resultDisqualificationWithdrawals.id })
        .from(schema.resultDisqualificationWithdrawals)
        .where(eq(schema.resultDisqualificationWithdrawals.disqualificationDecisionId, decision.id));
      if (alreadyWithdrawn) return { status: "conflict" } as const;
      const [target, disqualified, latest] = await Promise.all([
        tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, decision.targetResultRevisionId))
          .then((rows) => rows[0]),
        tx.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, decision.createdResultRevisionId))
          .then((rows) => rows[0]),
        tx.select().from(schema.resultRevisions).where(and(
          eq(schema.resultRevisions.raceId, race.id), eq(schema.resultRevisions.entryId, entry.id)
        )).orderBy(desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id)).limit(1)
          .then((rows) => rows[0])
      ]);
      if (!target || !disqualified || !latest) return { status: "conflict" } as const;
      validateStoredDisqualification(decision, target, disqualified);
      if (latest.id !== request.data.expectedAbsoluteResultRevision.id ||
          latest.revision !== request.data.expectedAbsoluteResultRevision.revision) {
        return { status: "conflict" } as const;
      }
      const source = latest.id === disqualified.id ? target : latest;
      let outcome;
      try {
        outcome = parseDisqualifiableTechnicalRevision(source);
      } catch (error) {
        if (error instanceof StoredResultRevisionConflict) return { status: "conflict" } as const;
        throw error;
      }
      if (source.id !== request.data.expectedRestorationSourceResultRevision.id ||
          source.revision !== request.data.expectedRestorationSourceResultRevision.revision ||
          outcome.status !== request.data.expectedRestorationSourceResultRevision.status ||
          outcome.reason !== request.data.expectedRestorationSourceResultRevision.reason ||
          outcome.classId !== entry.classId || outcome.courseVersionId !== raceClass.courseVersionId ||
          !isResultCurrent(source, await loadResultBasisHash(tx, entry.id), race.snapshotVersion)) {
        return { status: "conflict" } as const;
      }

      const withdrawalId = randomUUID();
      const resultRevisionId = randomUUID();
      const createdRevision = latest.revision + 1;
      const [withdrawal] = await tx.insert(schema.resultDisqualificationWithdrawals).values({
        id: withdrawalId,
        requestId,
        actorCredentialId: authorization.principal.accessCredentialId,
        raceId: race.id,
        entryId: entry.id,
        expectedEntryVersion: request.data.expectedEntryVersion,
        expectedClassId: request.data.expectedClassId,
        expectedCourseVersionId: request.data.expectedCourseVersionId,
        expectedSnapshotVersion: request.data.expectedSnapshotVersion,
        disqualificationDecisionId: decision.id,
        withdrawnResultRevisionId: disqualified.id,
        withdrawnResultRevision: disqualified.revision,
        expectedLatestResultRevisionId: latest.id,
        expectedLatestResultRevision: latest.revision,
        restoredFromResultRevisionId: source.id,
        restoredFromResultRevision: source.revision,
        policyVersion: request.data.policyVersion,
        reason: "ERRONEOUS_MANUAL_DISQUALIFICATION",
        createdResultRevisionId: resultRevisionId,
        createdResultRevision: createdRevision,
        withdrawnAt
      }).returning();
      if (!withdrawal) throw new Error("Diskvalifikationsåtertagandet kunde inte sparas");
      const [restoration] = await tx.insert(schema.resultRevisions).values({
        id: resultRevisionId,
        raceId: race.id,
        entryId: entry.id,
        readoutId: null,
        didNotStartDecisionId: null,
        disqualificationDecisionId: null,
        disqualificationWithdrawalId: withdrawal.id,
        revision: createdRevision,
        cause: "MANUAL_DISQUALIFICATION_WITHDRAWAL",
        status: outcome.status,
        reason: outcome.reason,
        evaluation: outcome,
        engineVersion: RESULT_DISQUALIFICATION_WITHDRAWAL_POLICY_VERSION,
        snapshotVersion: race.snapshotVersion,
        courseVersionId: source.courseVersionId,
        controlNeutralizationId: source.controlNeutralizationId,
        published: true,
        createdAt: withdrawnAt
      }).returning();
      if (!restoration) throw new Error("Återtagandets restaureringsrevision kunde inte sparas");
      await tx.insert(schema.auditEvents).values({
        raceId: race.id,
        entityType: "result_revision",
        entityId: restoration.id,
        action: "RESULT_DISQUALIFICATION_WITHDRAWN",
        actorKind: authorization.principal.capability === "MANAGE_RACE"
          ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "RESULT_DISQUALIFICATION_WITHDRAWAL_ACCESS_CREDENTIAL",
        actorId: authorization.principal.accessCredentialId,
        requestId,
        before: {
          resultDisqualificationDecisionId: decision.id,
          disqualifiedResultRevisionId: disqualified.id,
          absoluteResultRevisionId: latest.id,
          restorationSourceResultRevisionId: source.id
        },
        after: {
          resultDisqualificationWithdrawalId: withdrawal.id,
          resultRevisionId: restoration.id,
          revision: restoration.revision,
          status: restoration.status,
          reason: restoration.reason,
          policyVersion: withdrawal.policyVersion,
          snapshotVersion: restoration.snapshotVersion,
          courseVersionId: restoration.courseVersionId
        }
      });
      return { status: "withdrawn", response: responseFor(withdrawal, restoration, false) } as const;
    });
  } catch (error) {
    if (error instanceof StoredResultRevisionConflict) return { status: "conflict" };
    throw error;
  }
}

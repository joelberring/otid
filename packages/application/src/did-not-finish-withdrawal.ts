import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION,
  didNotFinishWithdrawalIdempotencyKeySchema,
  didNotFinishWithdrawalListResponseSchema,
  didNotFinishWithdrawalRequestSchema,
  didNotFinishWithdrawalResponseSchema,
  type DidNotFinishWithdrawalListResponse,
  type DidNotFinishWithdrawalRequest,
  type DidNotFinishWithdrawalResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import {
  parseDidNotFinishTechnicalRevision,
  StoredResultRevisionConflict,
  validateStoredDidNotFinish,
  validateStoredDidNotFinishWithdrawal
} from "./stored-result-revision";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_DECISIONS = 10_000;

type Withdrawal = typeof schema.didNotFinishWithdrawals.$inferSelect;
type Revision = typeof schema.resultRevisions.$inferSelect;

export type DidNotFinishWithdrawalListResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; response: DidNotFinishWithdrawalListResponse };

export async function listDidNotFinishWithdrawalsAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability">,
  now = new Date()
): Promise<DidNotFinishWithdrawalListResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "not-found" };
  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
        ...input,
        capability: "WITHDRAW_DID_NOT_FINISH"
      }, now);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
        .from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;

      const [decisions, absoluteRows] = await Promise.all([
        tx.select({ id: schema.didNotFinishDecisions.id }).from(schema.didNotFinishDecisions)
          .where(eq(schema.didNotFinishDecisions.raceId, race.id)).limit(MAX_DECISIONS + 1),
        tx.selectDistinctOn([schema.resultRevisions.entryId]).from(schema.resultRevisions)
          .where(eq(schema.resultRevisions.raceId, race.id))
          .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id))
      ]);
      if (decisions.length > MAX_DECISIONS) return { status: "conflict" } as const;
      const states = (await resolveStoredResultHeadStates(tx, race.id, absoluteRows))
        .flatMap((state) => state.didNotFinish === null ? [] : [state.didNotFinish]);
      const absoluteByEntry = new Map(absoluteRows.map((row) => [row.entryId, row]));
      const entryIds = states.map((state) => state.decision.entryId);
      const entries = entryIds.length === 0 ? [] : await tx.select({
        id: schema.entries.id,
        givenName: schema.entries.givenName,
        familyName: schema.entries.familyName,
        organisationName: schema.entries.organisationName,
        classId: schema.entries.classId,
        className: schema.classes.name,
        courseVersionId: schema.classes.courseVersionId,
        entryVersion: schema.entries.version
      }).from(schema.entries).innerJoin(schema.classes, and(
        eq(schema.entries.classId, schema.classes.id),
        eq(schema.classes.raceId, race.id)
      )).where(and(eq(schema.entries.raceId, race.id), inArray(schema.entries.id, entryIds)));
      const entryById = new Map(entries.map((entry) => [entry.id, entry]));

      const parsed = didNotFinishWithdrawalListResponseSchema.safeParse({
        formatVersion: 1,
        raceId: race.id,
        snapshotVersion: race.snapshotVersion,
        policyVersion: DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION,
        entries: states.map((state) => {
          const entry = entryById.get(state.decision.entryId);
          const absolute = absoluteByEntry.get(state.decision.entryId);
          if (!entry || !absolute) {
            throw new StoredResultRevisionConflict("DNF-beslutets aktuella entry eller resultathuvud saknas");
          }
          const source = state.withdrawal === null
            ? absolute.id === state.didNotFinish.id ? state.target : absolute
            : state.restorationSource;
          if (!source) throw new StoredResultRevisionConflict("DNF-återtagandets restaureringskälla saknas");
          const outcome = parseDidNotFinishTechnicalRevision(source);
          if (state.withdrawal === null && (
            outcome.classId !== entry.classId || outcome.courseVersionId !== entry.courseVersionId ||
            source.snapshotVersion !== race.snapshotVersion
          )) {
            throw new StoredResultRevisionConflict("DNF-återtagandets restaureringskälla är inaktuell");
          }
          return {
            id: entry.id,
            displayName: `${entry.givenName} ${entry.familyName}`,
            organisationName: entry.organisationName,
            classId: entry.classId,
            className: entry.className,
            courseVersionId: entry.courseVersionId,
            entryVersion: entry.entryVersion,
            state: state.withdrawal === null ? "WITHDRAWABLE" : "WITHDRAWN",
            didNotFinishDecisionId: state.decision.id,
            decidedAt: state.decision.decidedAt.toISOString(),
            targetResultRevision: { id: state.target.id, revision: state.target.revision },
            didNotFinishResultRevision: { id: state.didNotFinish.id, revision: state.didNotFinish.revision },
            absoluteResultRevision: { id: absolute.id, revision: absolute.revision },
            restorationSourceResultRevision: {
              id: source.id,
              revision: source.revision,
              status: outcome.status,
              reason: outcome.reason
            },
            withdrawal: state.withdrawal === null || state.restoration === null ? null : {
              id: state.withdrawal.id,
              restorationResultRevision: { id: state.restoration.id, revision: state.restoration.revision },
              reason: state.withdrawal.reason,
              policyVersion: state.withdrawal.policyVersion,
              withdrawnAt: state.withdrawal.withdrawnAt.toISOString()
            }
          };
        })
      });
      return parsed.success
        ? { status: "ok", response: parsed.data } as const
        : { status: "conflict" } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredResultRevisionConflict) return { status: "conflict" };
    throw error;
  }
}

export type WithdrawDidNotFinishInput = Omit<PairingAdminRequestAuthentication, "capability"> & {
  entryId: string;
  idempotencyKey: string | null;
  request: unknown;
};

export type WithdrawDidNotFinishResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "withdrawn"; response: DidNotFinishWithdrawalResponse };

function exactReplay(
  withdrawal: Withdrawal,
  actorCredentialId: string,
  raceId: string,
  entryId: string,
  request: DidNotFinishWithdrawalRequest
): boolean {
  return withdrawal.actorCredentialId === actorCredentialId && withdrawal.raceId === raceId &&
    withdrawal.entryId === entryId && withdrawal.expectedEntryVersion === request.expectedEntryVersion &&
    withdrawal.expectedClassId === request.expectedClassId &&
    withdrawal.expectedCourseVersionId === request.expectedCourseVersionId &&
    withdrawal.expectedSnapshotVersion === request.expectedSnapshotVersion &&
    withdrawal.didNotFinishDecisionId === request.expectedDidNotFinishDecisionId &&
    withdrawal.targetResultRevisionId === request.expectedTargetResultRevision.id &&
    withdrawal.targetResultRevision === request.expectedTargetResultRevision.revision &&
    withdrawal.withdrawnResultRevisionId === request.expectedDidNotFinishResultRevision.id &&
    withdrawal.withdrawnResultRevision === request.expectedDidNotFinishResultRevision.revision &&
    withdrawal.expectedLatestResultRevisionId === request.expectedAbsoluteResultRevision.id &&
    withdrawal.expectedLatestResultRevision === request.expectedAbsoluteResultRevision.revision &&
    withdrawal.restoredFromResultRevisionId === request.expectedRestorationSourceResultRevision.id &&
    withdrawal.restoredFromResultRevision === request.expectedRestorationSourceResultRevision.revision &&
    withdrawal.reason === request.reason && withdrawal.policyVersion === request.policyVersion;
}

function responseFor(
  withdrawal: Withdrawal,
  restoration: Revision,
  replayed: boolean
): DidNotFinishWithdrawalResponse {
  return didNotFinishWithdrawalResponseSchema.parse({
    formatVersion: 1,
    replayed,
    requestId: withdrawal.requestId,
    raceId: withdrawal.raceId,
    entryId: withdrawal.entryId,
    didNotFinishWithdrawalId: withdrawal.id,
    didNotFinishDecisionId: withdrawal.didNotFinishDecisionId,
    didNotFinishResultRevisionId: withdrawal.withdrawnResultRevisionId,
    restorationSourceResultRevisionId: withdrawal.restoredFromResultRevisionId,
    restorationResultRevisionId: restoration.id,
    revision: restoration.revision,
    cause: restoration.cause,
    status: restoration.status,
    reason: restoration.reason,
    withdrawalReason: withdrawal.reason,
    policyVersion: withdrawal.policyVersion,
    snapshotVersion: restoration.snapshotVersion,
    courseVersionId: restoration.courseVersionId,
    withdrawnAt: withdrawal.withdrawnAt.toISOString()
  });
}

export async function withdrawDidNotFinishAsAdmin(
  db: Database,
  input: WithdrawDidNotFinishInput,
  now = new Date()
): Promise<WithdrawDidNotFinishResult> {
  const key = didNotFinishWithdrawalIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = didNotFinishWithdrawalRequestSchema.safeParse(input.request);
  if (!key.success || !request.success || !UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.entryId)) {
    return { status: "invalid-request" };
  }
  const requestId = key.data.slice("did-not-finish-withdrawal:".length);
  const withdrawnAt = new Date(now);
  if (!Number.isFinite(withdrawnAt.getTime())) throw new Error("DNF-återtagandetiden är ogiltig");
  const preflight = await authenticatePairingAdminSession(db, {
    ...input,
    capability: "WITHDRAW_DID_NOT_FINISH",
    requireCsrf: true
  }, withdrawnAt);
  if (preflight.status !== "authenticated") return preflight;

  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForMutation(tx, {
        ...input,
        capability: "WITHDRAW_DID_NOT_FINISH",
        requireCsrf: true
      }, withdrawnAt);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
        .from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);

      const [existing] = await tx.select().from(schema.didNotFinishWithdrawals)
        .where(eq(schema.didNotFinishWithdrawals.requestId, requestId));
      if (existing) {
        if (!exactReplay(existing, authorization.principal.accessCredentialId, race.id, input.entryId, request.data)) {
          return { status: "conflict" } as const;
        }
        const [decision, target, didNotFinish, expectedLatest, source, restoration] = await Promise.all([
          tx.select().from(schema.didNotFinishDecisions)
            .where(eq(schema.didNotFinishDecisions.id, existing.didNotFinishDecisionId)).then((rows) => rows[0]),
          tx.select().from(schema.resultRevisions)
            .where(eq(schema.resultRevisions.id, existing.targetResultRevisionId)).then((rows) => rows[0]),
          tx.select().from(schema.resultRevisions)
            .where(eq(schema.resultRevisions.id, existing.withdrawnResultRevisionId)).then((rows) => rows[0]),
          tx.select().from(schema.resultRevisions)
            .where(eq(schema.resultRevisions.id, existing.expectedLatestResultRevisionId)).then((rows) => rows[0]),
          tx.select().from(schema.resultRevisions)
            .where(eq(schema.resultRevisions.id, existing.restoredFromResultRevisionId)).then((rows) => rows[0]),
          tx.select().from(schema.resultRevisions)
            .where(eq(schema.resultRevisions.id, existing.createdResultRevisionId)).then((rows) => rows[0])
        ]);
        if (!decision || !target || !didNotFinish || !expectedLatest || !source || !restoration) {
          throw new Error("DNF-återtagandets revisionskedja saknas");
        }
        const sourceOutcome = parseDidNotFinishTechnicalRevision(source);
        if (sourceOutcome.status !== request.data.expectedRestorationSourceResultRevision.status ||
            sourceOutcome.reason !== request.data.expectedRestorationSourceResultRevision.reason) {
          return { status: "conflict" } as const;
        }
        validateStoredDidNotFinishWithdrawal(
          existing, decision, target, didNotFinish, expectedLatest, source, restoration
        );
        return { status: "withdrawn", response: responseFor(existing, restoration, true) } as const;
      }

      const [entry] = await tx.select().from(schema.entries).where(and(
        eq(schema.entries.id, input.entryId),
        eq(schema.entries.raceId, race.id)
      )).for("update");
      if (!entry) return { status: "not-found" } as const;
      if (entry.version !== request.data.expectedEntryVersion ||
          entry.classId !== request.data.expectedClassId ||
          race.snapshotVersion !== request.data.expectedSnapshotVersion ||
          request.data.policyVersion !== DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION ||
          request.data.reason !== "ERRONEOUS_MANUAL_DID_NOT_FINISH") {
        return { status: "conflict" } as const;
      }
      const [raceClass] = await tx.select({ courseVersionId: schema.classes.courseVersionId })
        .from(schema.classes).where(and(eq(schema.classes.id, entry.classId), eq(schema.classes.raceId, race.id)));
      if (!raceClass || raceClass.courseVersionId !== request.data.expectedCourseVersionId) {
        return { status: "conflict" } as const;
      }
      const [latest] = await tx.select().from(schema.resultRevisions).where(and(
        eq(schema.resultRevisions.raceId, race.id),
        eq(schema.resultRevisions.entryId, entry.id)
      )).orderBy(desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id)).limit(1);
      if (!latest || latest.id !== request.data.expectedAbsoluteResultRevision.id ||
          latest.revision !== request.data.expectedAbsoluteResultRevision.revision) {
        return { status: "conflict" } as const;
      }
      const [resolved] = await resolveStoredResultHeadStates(tx, race.id, [latest]);
      const lifecycle = resolved?.state === "ACTIVE_RESULT" ? resolved.didNotFinish : null;
      if (!lifecycle || lifecycle.withdrawal !== null ||
          lifecycle.decision.id !== request.data.expectedDidNotFinishDecisionId ||
          lifecycle.target.id !== request.data.expectedTargetResultRevision.id ||
          lifecycle.target.revision !== request.data.expectedTargetResultRevision.revision ||
          lifecycle.didNotFinish.id !== request.data.expectedDidNotFinishResultRevision.id ||
          lifecycle.didNotFinish.revision !== request.data.expectedDidNotFinishResultRevision.revision) {
        return { status: "conflict" } as const;
      }
      validateStoredDidNotFinish(lifecycle.decision, lifecycle.target, lifecycle.didNotFinish);
      const source = latest.id === lifecycle.didNotFinish.id ? lifecycle.target : latest;
      const outcome = parseDidNotFinishTechnicalRevision(source);
      if (source.id !== request.data.expectedRestorationSourceResultRevision.id ||
          source.revision !== request.data.expectedRestorationSourceResultRevision.revision ||
          outcome.status !== request.data.expectedRestorationSourceResultRevision.status ||
          outcome.reason !== request.data.expectedRestorationSourceResultRevision.reason ||
          outcome.classId !== entry.classId || outcome.courseVersionId !== raceClass.courseVersionId ||
          source.snapshotVersion !== race.snapshotVersion) {
        return { status: "conflict" } as const;
      }

      const withdrawalId = randomUUID();
      const resultRevisionId = randomUUID();
      const createdRevision = latest.revision + 1;
      const [withdrawal] = await tx.insert(schema.didNotFinishWithdrawals).values({
        id: withdrawalId,
        requestId,
        actorCredentialId: authorization.principal.accessCredentialId,
        raceId: race.id,
        entryId: entry.id,
        expectedEntryVersion: request.data.expectedEntryVersion,
        expectedClassId: request.data.expectedClassId,
        expectedCourseVersionId: request.data.expectedCourseVersionId,
        expectedSnapshotVersion: request.data.expectedSnapshotVersion,
        didNotFinishDecisionId: lifecycle.decision.id,
        targetResultRevisionId: lifecycle.target.id,
        targetResultRevision: lifecycle.target.revision,
        withdrawnResultRevisionId: lifecycle.didNotFinish.id,
        withdrawnResultRevision: lifecycle.didNotFinish.revision,
        expectedLatestResultRevisionId: latest.id,
        expectedLatestResultRevision: latest.revision,
        restoredFromResultRevisionId: source.id,
        restoredFromResultRevision: source.revision,
        policyVersion: request.data.policyVersion,
        reason: request.data.reason,
        createdResultRevisionId: resultRevisionId,
        createdResultRevision: createdRevision,
        withdrawnAt
      }).returning();
      if (!withdrawal) throw new Error("DNF-återtagandet kunde inte sparas");
      const [restoration] = await tx.insert(schema.resultRevisions).values({
        id: resultRevisionId,
        raceId: race.id,
        entryId: entry.id,
        readoutId: null,
        didNotStartDecisionId: null,
        disqualificationDecisionId: null,
        disqualificationWithdrawalId: null,
        approvalDecisionId: null,
        approvalWithdrawalId: null,
        didNotFinishDecisionId: null,
        didNotFinishWithdrawalId: withdrawal.id,
        revision: createdRevision,
        cause: "MANUAL_DID_NOT_FINISH_WITHDRAWAL",
        status: outcome.status,
        reason: outcome.reason,
        evaluation: outcome,
        engineVersion: DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION,
        snapshotVersion: source.snapshotVersion,
        courseVersionId: source.courseVersionId,
        controlNeutralizationId: source.controlNeutralizationId,
        published: true,
        createdAt: withdrawnAt
      }).returning();
      if (!restoration) throw new Error("DNF-återtagandets restaureringsrevision kunde inte sparas");
      await tx.insert(schema.auditEvents).values({
        raceId: race.id,
        entityType: "result_revision",
        entityId: restoration.id,
        action: "DID_NOT_FINISH_WITHDRAWN",
        actorKind: authorization.principal.capability === "MANAGE_RACE"
          ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "DID_NOT_FINISH_WITHDRAWAL_ACCESS_CREDENTIAL",
        actorId: authorization.principal.accessCredentialId,
        requestId,
        before: {
          didNotFinishDecisionId: lifecycle.decision.id,
          didNotFinishResultRevisionId: lifecycle.didNotFinish.id,
          absoluteResultRevisionId: latest.id,
          restorationSourceResultRevisionId: source.id
        },
        after: {
          didNotFinishWithdrawalId: withdrawal.id,
          resultRevisionId: restoration.id,
          revision: restoration.revision,
          status: restoration.status,
          reason: restoration.reason,
          withdrawalReason: withdrawal.reason,
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

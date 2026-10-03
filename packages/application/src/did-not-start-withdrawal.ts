import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  didNotStartWithdrawalIdempotencyKeySchema,
  didNotStartWithdrawalListResponseSchema,
  didNotStartWithdrawalRequestSchema,
  didNotStartWithdrawalResponseSchema,
  resultOutcomeSchema,
  type DidNotStartWithdrawalListResponse,
  type DidNotStartWithdrawalRequest,
  type DidNotStartWithdrawalResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { DID_NOT_START_WITHDRAWAL_POLICY_VERSION } from "@o-tid/domain";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_DECISIONS = 10_000;

class StoredDidNotStartWithdrawalConflict extends Error {}

type Decision = typeof schema.didNotStartDecisions.$inferSelect;
type ResultRevision = typeof schema.resultRevisions.$inferSelect;
type Withdrawal = typeof schema.didNotStartWithdrawals.$inferSelect;

export type DidNotStartWithdrawalListResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; response: DidNotStartWithdrawalListResponse };

function manualDnsSourceMatches(decision: Decision, revision: ResultRevision): boolean {
  const evaluation = resultOutcomeSchema.safeParse(revision.evaluation);
  return revision.id === decision.createdResultRevisionId &&
    revision.raceId === decision.raceId && revision.entryId === decision.entryId &&
    revision.revision === decision.createdResultRevision &&
    revision.didNotStartDecisionId === decision.id && revision.readoutId === null &&
    revision.cause === "MANUAL_DID_NOT_START" && revision.status === "DNS" &&
    revision.reason === "DID_NOT_START" && revision.published && evaluation.success &&
    evaluation.data.status === "DNS" && evaluation.data.reason === "DID_NOT_START" &&
    evaluation.data.entryId === decision.entryId &&
    evaluation.data.classId === decision.expectedClassId &&
    evaluation.data.courseVersionId === decision.expectedCourseVersionId &&
    revision.courseVersionId === decision.expectedCourseVersionId;
}

export async function listDidNotStartWithdrawalsAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability">,
  now = new Date()
): Promise<DidNotStartWithdrawalListResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "not-found" };
  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
        ...input,
        capability: "WITHDRAW_DID_NOT_START"
      }, now);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
        .from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;

      const rows = await tx.select({
        decision: schema.didNotStartDecisions,
        target: schema.resultRevisions,
        entryId: schema.entries.id,
        givenName: schema.entries.givenName,
        familyName: schema.entries.familyName,
        organisationName: schema.entries.organisationName,
        classId: schema.entries.classId,
        className: schema.classes.name,
        courseVersionId: schema.classes.courseVersionId,
        entryVersion: schema.entries.version
      }).from(schema.didNotStartDecisions)
        .innerJoin(schema.resultRevisions,
          eq(schema.resultRevisions.id, schema.didNotStartDecisions.createdResultRevisionId))
        .innerJoin(schema.entries, and(
          eq(schema.entries.id, schema.didNotStartDecisions.entryId),
          eq(schema.entries.raceId, race.id)
        ))
        .innerJoin(schema.classes, and(
          eq(schema.classes.id, schema.entries.classId),
          eq(schema.classes.raceId, race.id)
        ))
        .where(eq(schema.didNotStartDecisions.raceId, race.id))
        .orderBy(desc(schema.didNotStartDecisions.decidedAt), asc(schema.didNotStartDecisions.id))
        .limit(MAX_DECISIONS + 1);
      if (rows.length > MAX_DECISIONS) return { status: "conflict" } as const;

      const [latestRows, withdrawals] = await Promise.all([
        tx.selectDistinctOn([schema.resultRevisions.entryId], {
          id: schema.resultRevisions.id,
          entryId: schema.resultRevisions.entryId,
          revision: schema.resultRevisions.revision,
          cause: schema.resultRevisions.cause,
          status: schema.resultRevisions.status,
          reason: schema.resultRevisions.reason,
          createdAt: schema.resultRevisions.createdAt,
          snapshotVersion: schema.resultRevisions.snapshotVersion
        }).from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, race.id))
          .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id)),
        tx.select().from(schema.didNotStartWithdrawals)
          .where(eq(schema.didNotStartWithdrawals.raceId, race.id))
      ]);
      const latestByEntry = new Map(latestRows.map((row) => [row.entryId, row]));
      const withdrawalByDecision = new Map(withdrawals.map((row) => [row.didNotStartDecisionId, row]));
      if (withdrawalByDecision.size !== withdrawals.length) return { status: "conflict" } as const;

      const parsed = didNotStartWithdrawalListResponseSchema.safeParse({
        formatVersion: 1,
        raceId: race.id,
        snapshotVersion: race.snapshotVersion,
        withdrawalPolicyVersion: DID_NOT_START_WITHDRAWAL_POLICY_VERSION,
        entries: rows.map((row) => {
          if (!manualDnsSourceMatches(row.decision, row.target)) {
            throw new StoredDidNotStartWithdrawalConflict("Det manuella DNS-beslutet motsäger sin resultatrevision");
          }
          const latest = latestByEntry.get(row.entryId);
          if (!latest) throw new StoredDidNotStartWithdrawalConflict("Det manuella DNS-beslutets resultathuvud saknas");
          const withdrawal = withdrawalByDecision.get(row.decision.id);
          const state = withdrawal !== undefined ? "WITHDRAWN" :
            latest.id === row.target.id && latest.revision === row.target.revision ? "WITHDRAWABLE" : "SUPERSEDED";
          return {
            id: row.entryId,
            displayName: `${row.givenName} ${row.familyName}`,
            organisationName: row.organisationName,
            classId: row.classId,
            className: row.className,
            courseVersionId: row.courseVersionId,
            entryVersion: row.entryVersion,
            didNotStartDecisionId: row.decision.id,
            decidedAt: row.decision.decidedAt.toISOString(),
            state,
            targetResultRevision: {
              id: row.target.id,
              revision: row.target.revision,
              createdAt: row.target.createdAt.toISOString(),
              snapshotVersion: row.target.snapshotVersion
            },
            latestResultRevision: {
              id: latest.id,
              revision: latest.revision,
              cause: latest.cause,
              status: latest.status,
              reason: latest.reason,
              createdAt: latest.createdAt.toISOString(),
              snapshotVersion: latest.snapshotVersion
            },
            withdrawal: withdrawal === undefined ? null : {
              id: withdrawal.id,
              reason: withdrawal.reason,
              policyVersion: withdrawal.policyVersion,
              withdrawnAt: withdrawal.withdrawnAt.toISOString()
            }
          };
        })
      });
      return parsed.success ? { status: "ok", response: parsed.data } as const : { status: "conflict" } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredDidNotStartWithdrawalConflict) return { status: "conflict" };
    throw error;
  }
}

export type WithdrawDidNotStartInput = Omit<PairingAdminRequestAuthentication, "capability"> & {
  entryId: string;
  idempotencyKey: string | null;
  request: unknown;
};

export type WithdrawDidNotStartResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "withdrawn"; response: DidNotStartWithdrawalResponse };

function exactReplay(
  withdrawal: Withdrawal,
  actorCredentialId: string,
  raceId: string,
  entryId: string,
  request: DidNotStartWithdrawalRequest
): boolean {
  return withdrawal.actorCredentialId === actorCredentialId && withdrawal.raceId === raceId &&
    withdrawal.entryId === entryId && withdrawal.expectedEntryVersion === request.expectedEntryVersion &&
    withdrawal.expectedClassId === request.expectedClassId &&
    withdrawal.expectedCourseVersionId === request.expectedCourseVersionId &&
    withdrawal.expectedSnapshotVersion === request.expectedSnapshotVersion &&
    withdrawal.didNotStartDecisionId === request.expectedDidNotStartDecisionId &&
    withdrawal.withdrawnResultRevisionId === request.expectedResultRevision.id &&
    withdrawal.expectedLatestResultRevision === request.expectedResultRevision.revision &&
    withdrawal.policyVersion === request.policyVersion && withdrawal.reason === "ERRONEOUS_MANUAL_DNS";
}

function responseFor(withdrawal: Withdrawal, replayed: boolean): DidNotStartWithdrawalResponse {
  return didNotStartWithdrawalResponseSchema.parse({
    formatVersion: 1,
    replayed,
    requestId: withdrawal.requestId,
    raceId: withdrawal.raceId,
    entryId: withdrawal.entryId,
    withdrawalId: withdrawal.id,
    didNotStartDecisionId: withdrawal.didNotStartDecisionId,
    withdrawnResultRevisionId: withdrawal.withdrawnResultRevisionId,
    withdrawnResultRevision: withdrawal.expectedLatestResultRevision,
    withdrawalPolicyVersion: withdrawal.policyVersion,
    reason: withdrawal.reason,
    withdrawnAt: withdrawal.withdrawnAt.toISOString()
  });
}

export async function withdrawDidNotStartAsAdmin(
  db: Database,
  input: WithdrawDidNotStartInput,
  now = new Date()
): Promise<WithdrawDidNotStartResult> {
  const key = didNotStartWithdrawalIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = didNotStartWithdrawalRequestSchema.safeParse(input.request);
  if (!key.success || !request.success || !UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.entryId)) {
    return { status: "invalid-request" };
  }
  const requestId = key.data.slice("did-not-start-withdrawal:".length);
  const withdrawnAt = new Date(now);
  if (!Number.isFinite(withdrawnAt.getTime())) throw new Error("Återtagandetiden är ogiltig");
  const preflight = await authenticatePairingAdminSession(db, {
    ...input,
    capability: "WITHDRAW_DID_NOT_START",
    requireCsrf: true
  }, withdrawnAt);
  if (preflight.status !== "authenticated") return preflight;

  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForMutation(tx, {
      ...input,
      capability: "WITHDRAW_DID_NOT_START",
      requireCsrf: true
    }, withdrawnAt);
    if (authorization.status !== "authenticated") return authorization;
    const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
      .from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
    if (!race) return { status: "not-found" } as const;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);

    const [existing] = await tx.select().from(schema.didNotStartWithdrawals)
      .where(eq(schema.didNotStartWithdrawals.requestId, requestId));
    if (existing) {
      if (!exactReplay(existing, authorization.principal.accessCredentialId, race.id, input.entryId, request.data)) {
        return { status: "conflict" } as const;
      }
      return { status: "withdrawn", response: responseFor(existing, true) } as const;
    }

    const [entry] = await tx.select().from(schema.entries).where(and(
      eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, race.id)
    )).for("update");
    if (!entry) return { status: "not-found" } as const;
    if (entry.version !== request.data.expectedEntryVersion || entry.classId !== request.data.expectedClassId ||
        race.snapshotVersion !== request.data.expectedSnapshotVersion ||
        request.data.policyVersion !== DID_NOT_START_WITHDRAWAL_POLICY_VERSION) {
      return { status: "conflict" } as const;
    }
    const [raceClass] = await tx.select({ id: schema.classes.id, courseVersionId: schema.classes.courseVersionId })
      .from(schema.classes).where(and(eq(schema.classes.id, entry.classId), eq(schema.classes.raceId, race.id)));
    if (!raceClass || raceClass.courseVersionId !== request.data.expectedCourseVersionId) {
      return { status: "conflict" } as const;
    }
    const [decision] = await tx.select().from(schema.didNotStartDecisions).where(and(
      eq(schema.didNotStartDecisions.id, request.data.expectedDidNotStartDecisionId),
      eq(schema.didNotStartDecisions.raceId, race.id),
      eq(schema.didNotStartDecisions.entryId, entry.id)
    ));
    if (!decision || decision.createdResultRevisionId !== request.data.expectedResultRevision.id ||
        decision.createdResultRevision !== request.data.expectedResultRevision.revision) {
      return { status: "conflict" } as const;
    }
    const [existingTargetWithdrawal] = await tx.select({ id: schema.didNotStartWithdrawals.id })
      .from(schema.didNotStartWithdrawals)
      .where(eq(schema.didNotStartWithdrawals.didNotStartDecisionId, decision.id));
    if (existingTargetWithdrawal) return { status: "conflict" } as const;
    const [target] = await tx.select().from(schema.resultRevisions).where(and(
      eq(schema.resultRevisions.id, request.data.expectedResultRevision.id),
      eq(schema.resultRevisions.raceId, race.id),
      eq(schema.resultRevisions.entryId, entry.id)
    ));
    if (!target || !manualDnsSourceMatches(decision, target)) return { status: "conflict" } as const;
    const [latest] = await tx.select({ id: schema.resultRevisions.id, revision: schema.resultRevisions.revision })
      .from(schema.resultRevisions).where(and(
        eq(schema.resultRevisions.raceId, race.id), eq(schema.resultRevisions.entryId, entry.id)
      )).orderBy(desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id)).limit(1);
    if (!latest || latest.id !== target.id || latest.revision !== target.revision) {
      return { status: "conflict" } as const;
    }

    const [created] = await tx.insert(schema.didNotStartWithdrawals).values({
      id: randomUUID(),
      requestId,
      actorCredentialId: authorization.principal.accessCredentialId,
      raceId: race.id,
      entryId: entry.id,
      didNotStartDecisionId: decision.id,
      withdrawnResultRevisionId: target.id,
      expectedEntryVersion: request.data.expectedEntryVersion,
      expectedClassId: request.data.expectedClassId,
      expectedCourseVersionId: request.data.expectedCourseVersionId,
      expectedSnapshotVersion: request.data.expectedSnapshotVersion,
      expectedLatestResultRevision: request.data.expectedResultRevision.revision,
      policyVersion: request.data.policyVersion,
      reason: "ERRONEOUS_MANUAL_DNS",
      withdrawnAt
    }).returning();
    if (!created) throw new Error("DNS-återtagandet kunde inte sparas");
    await tx.insert(schema.auditEvents).values({
      raceId: race.id,
      entityType: "did_not_start_withdrawal",
      entityId: created.id,
      action: "DID_NOT_START_WITHDRAWN",
      actorKind: authorization.principal.capability === "MANAGE_RACE"
        ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "DID_NOT_START_WITHDRAWAL_ACCESS_CREDENTIAL",
      actorId: authorization.principal.accessCredentialId,
      requestId,
      after: {
        entryId: entry.id,
        didNotStartDecisionId: decision.id,
        withdrawnResultRevisionId: target.id,
        withdrawnResultRevision: target.revision,
        policyVersion: created.policyVersion,
        reason: created.reason,
        withdrawnAt: created.withdrawnAt.toISOString()
      }
    });
    return { status: "withdrawn", response: responseFor(created, false) } as const;
  });
}

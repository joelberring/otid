import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  RESULT_DISQUALIFICATION_POLICY_VERSION,
  resultDisqualificationCandidateResponseSchema,
  resultDisqualificationIdempotencyKeySchema,
  resultDisqualificationRequestSchema,
  resultDisqualificationResponseSchema,
  type ResultDisqualificationCandidateResponse,
  type ResultDisqualificationRequest,
  type ResultDisqualificationResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { createDisqualifiedResult } from "@o-tid/domain";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import {
  StoredResultRevisionConflict,
  parseDisqualifiableTechnicalRevision,
  validateStoredDisqualification
} from "./stored-result-revision";
import { loadActiveManualResultOverrideState, resolveStoredResultHeadStates } from "./result-revision-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ENTRIES = 10_000;

type Decision = typeof schema.resultDisqualificationDecisions.$inferSelect;
type Revision = typeof schema.resultRevisions.$inferSelect;

export type ResultDisqualificationCandidateListResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; response: ResultDisqualificationCandidateResponse };

export async function listResultDisqualificationCandidatesAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability">,
  now = new Date()
): Promise<ResultDisqualificationCandidateListResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "not-found" };
  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
        ...input,
        capability: "DISQUALIFY_RESULT"
      }, now);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
        .from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;

      const [entries, latestRows] = await Promise.all([
        tx.select({
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
          .where(eq(schema.entries.raceId, race.id))
          .orderBy(asc(schema.entries.familyName), asc(schema.entries.givenName), asc(schema.entries.id))
          .limit(MAX_ENTRIES + 1),
        tx.selectDistinctOn([schema.resultRevisions.entryId])
          .from(schema.resultRevisions)
          .where(eq(schema.resultRevisions.raceId, race.id))
          .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id))
      ]);
      if (entries.length > MAX_ENTRIES) return { status: "conflict" } as const;

      const latestByEntry = new Map(latestRows.map((row) => [row.entryId, row]));
      const stateByEntry = new Map(
        (await resolveStoredResultHeadStates(tx, race.id, latestRows)).map((state) => [state.selectedHead.entryId, state])
      );
      const parsed = resultDisqualificationCandidateResponseSchema.safeParse({
        formatVersion: 1,
        raceId: race.id,
        snapshotVersion: race.snapshotVersion,
        policyVersion: RESULT_DISQUALIFICATION_POLICY_VERSION,
        entries: entries.map(({ givenName, familyName, ...entry }) => {
          const latest = latestByEntry.get(entry.id);
          const state = stateByEntry.get(entry.id);
          let readiness: "READY" | "NO_ACTIVE_RESULT" | "UNSUPPORTED_RESULT" |
            "UNPUBLISHED_RESULT" | "STALE_RESULT" | "ACTIVE_DISQUALIFICATION" |
            "ACTIVE_APPROVAL" | "ACTIVE_DID_NOT_FINISH" | "ACTIVE_OUT_OF_COMPETITION" |
            "ACTIVE_WITHOUT_TIMING";
          let targetResultRevision: null | {
            id: string;
            revision: number;
            status: "OK" | "MP";
            reason: string;
            cause: "CARD_READOUT" | "CLASS_CHANGE_RECALCULATION" | "EXPLICIT_RECALCULATION" | "UNKNOWN_READOUT_RESOLUTION";
            createdAt: string;
            snapshotVersion: number;
          } = null;
          if (state?.withoutTiming?.withdrawal === null) {
            readiness = "ACTIVE_WITHOUT_TIMING";
          } else if (state?.notCompeting?.withdrawal === null) {
            readiness = "ACTIVE_OUT_OF_COMPETITION";
          } else if (state?.didNotFinish?.withdrawal === null) {
            readiness = "ACTIVE_DID_NOT_FINISH";
          } else if (state?.approval?.withdrawal === null) {
            readiness = "ACTIVE_APPROVAL";
          } else if (state?.disqualification?.withdrawal === null) {
            readiness = "ACTIVE_DISQUALIFICATION";
          } else if (!latest) {
            readiness = "NO_ACTIVE_RESULT";
          } else if (!latest.published) {
            readiness = "UNPUBLISHED_RESULT";
          } else {
            try {
              const outcome = parseDisqualifiableTechnicalRevision(latest);
              if (outcome.classId !== entry.classId || outcome.courseVersionId !== entry.courseVersionId ||
                  latest.snapshotVersion !== race.snapshotVersion) {
                readiness = "STALE_RESULT";
              } else {
                readiness = "READY";
                targetResultRevision = {
                  id: latest.id,
                  revision: latest.revision,
                  status: outcome.status,
                  reason: outcome.reason,
                  cause: latest.cause as "CARD_READOUT" | "CLASS_CHANGE_RECALCULATION" | "EXPLICIT_RECALCULATION" | "UNKNOWN_READOUT_RESOLUTION",
                  createdAt: latest.createdAt.toISOString(),
                  snapshotVersion: latest.snapshotVersion
                };
              }
            } catch (error) {
              if (!(error instanceof StoredResultRevisionConflict)) throw error;
              readiness = "UNSUPPORTED_RESULT";
            }
          }
          return {
            ...entry,
            displayName: `${givenName} ${familyName}`,
            readiness,
            targetResultRevision
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

export type DisqualifyResultInput = Omit<PairingAdminRequestAuthentication, "capability"> & {
  entryId: string;
  idempotencyKey: string | null;
  request: unknown;
};

export type DisqualifyResultResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "disqualified"; response: ResultDisqualificationResponse };

function exactReplay(
  decision: Decision,
  actorCredentialId: string,
  raceId: string,
  entryId: string,
  request: ResultDisqualificationRequest
): boolean {
  return decision.actorCredentialId === actorCredentialId && decision.raceId === raceId &&
    decision.entryId === entryId && decision.expectedEntryVersion === request.expectedEntryVersion &&
    decision.expectedClassId === request.expectedClassId &&
    decision.expectedCourseVersionId === request.expectedCourseVersionId &&
    decision.expectedSnapshotVersion === request.expectedSnapshotVersion &&
    decision.targetResultRevisionId === request.expectedResultRevision.id &&
    decision.targetResultRevision === request.expectedResultRevision.revision &&
    decision.policyVersion === request.policyVersion;
}

function responseFor(decision: Decision, revision: Revision, replayed: boolean): ResultDisqualificationResponse {
  return resultDisqualificationResponseSchema.parse({
    formatVersion: 1,
    replayed,
    requestId: decision.requestId,
    raceId: decision.raceId,
    entryId: decision.entryId,
    resultDisqualificationDecisionId: decision.id,
    targetResultRevisionId: decision.targetResultRevisionId,
    targetResultRevision: decision.targetResultRevision,
    resultRevisionId: revision.id,
    revision: revision.revision,
    cause: revision.cause,
    status: revision.status,
    reason: revision.reason,
    policyVersion: decision.policyVersion,
    snapshotVersion: revision.snapshotVersion,
    courseVersionId: revision.courseVersionId,
    decidedAt: decision.decidedAt.toISOString()
  });
}

export async function disqualifyResultAsAdmin(
  db: Database,
  input: DisqualifyResultInput,
  now = new Date()
): Promise<DisqualifyResultResult> {
  const key = resultDisqualificationIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = resultDisqualificationRequestSchema.safeParse(input.request);
  if (!key.success || !request.success || !UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.entryId)) {
    return { status: "invalid-request" };
  }
  const requestId = key.data.slice("manual-disqualification:".length);
  const decidedAt = new Date(now);
  if (!Number.isFinite(decidedAt.getTime())) throw new Error("Beslutstiden är ogiltig");
  const preflight = await authenticatePairingAdminSession(db, {
    ...input,
    capability: "DISQUALIFY_RESULT",
    requireCsrf: true
  }, decidedAt);
  if (preflight.status !== "authenticated") return preflight;

  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForMutation(tx, {
        ...input,
        capability: "DISQUALIFY_RESULT",
        requireCsrf: true
      }, decidedAt);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
        .from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);

      const [existing] = await tx.select().from(schema.resultDisqualificationDecisions)
        .where(eq(schema.resultDisqualificationDecisions.requestId, requestId));
      if (existing) {
        if (!exactReplay(existing, authorization.principal.accessCredentialId, race.id, input.entryId, request.data)) {
          return { status: "conflict" } as const;
        }
        const [target, disqualified] = await Promise.all([
          tx.select().from(schema.resultRevisions)
            .where(eq(schema.resultRevisions.id, existing.targetResultRevisionId)).then((rows) => rows[0]),
          tx.select().from(schema.resultRevisions)
            .where(eq(schema.resultRevisions.id, existing.createdResultRevisionId)).then((rows) => rows[0])
        ]);
        if (!target || !disqualified) throw new Error("Diskvalifikationens resultatrevisioner saknas");
        const source = parseDisqualifiableTechnicalRevision(target);
        if (source.status !== request.data.expectedResultRevision.status) {
          return { status: "conflict" } as const;
        }
        validateStoredDisqualification(existing, target, disqualified);
        return { status: "disqualified", response: responseFor(existing, disqualified, true) } as const;
      }

      const [entry] = await tx.select().from(schema.entries).where(and(
        eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, race.id)
      )).for("update");
      if (!entry) return { status: "not-found" } as const;
      if (entry.version !== request.data.expectedEntryVersion || entry.classId !== request.data.expectedClassId ||
          race.snapshotVersion !== request.data.expectedSnapshotVersion ||
          request.data.policyVersion !== RESULT_DISQUALIFICATION_POLICY_VERSION) {
        return { status: "conflict" } as const;
      }
      const [raceClass] = await tx.select({ id: schema.classes.id, courseVersionId: schema.classes.courseVersionId })
        .from(schema.classes).where(and(eq(schema.classes.id, entry.classId), eq(schema.classes.raceId, race.id)));
      if (!raceClass || raceClass.courseVersionId !== request.data.expectedCourseVersionId) {
        return { status: "conflict" } as const;
      }
      const decisions = await tx.select({ id: schema.resultDisqualificationDecisions.id })
        .from(schema.resultDisqualificationDecisions)
        .where(and(
          eq(schema.resultDisqualificationDecisions.raceId, race.id),
          eq(schema.resultDisqualificationDecisions.entryId, entry.id)
        ));
      if (decisions.length > 0) {
        const withdrawals = await tx.select({ decisionId: schema.resultDisqualificationWithdrawals.disqualificationDecisionId })
          .from(schema.resultDisqualificationWithdrawals)
          .where(inArray(schema.resultDisqualificationWithdrawals.disqualificationDecisionId, decisions.map((row) => row.id)));
        const withdrawn = new Set(withdrawals.map((row) => row.decisionId));
        if (decisions.some((row) => !withdrawn.has(row.id))) return { status: "conflict" } as const;
      }
      const [latest] = await tx.select().from(schema.resultRevisions).where(and(
        eq(schema.resultRevisions.raceId, race.id), eq(schema.resultRevisions.entryId, entry.id)
      )).orderBy(desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id)).limit(1);
      if (!latest || latest.id !== request.data.expectedResultRevision.id ||
          latest.revision !== request.data.expectedResultRevision.revision) {
        return { status: "conflict" } as const;
      }
      if (await loadActiveManualResultOverrideState(tx, race.id, latest) !== "NONE") {
        return { status: "conflict" } as const;
      }
      let source;
      try {
        source = parseDisqualifiableTechnicalRevision(latest);
      } catch (error) {
        if (error instanceof StoredResultRevisionConflict) return { status: "conflict" } as const;
        throw error;
      }
      if (source.status !== request.data.expectedResultRevision.status ||
          source.classId !== entry.classId || source.courseVersionId !== raceClass.courseVersionId ||
          latest.snapshotVersion !== race.snapshotVersion) {
        return { status: "conflict" } as const;
      }

      const outcome = createDisqualifiedResult(source);
      const decisionId = randomUUID();
      const resultRevisionId = randomUUID();
      const createdRevision = latest.revision + 1;
      const [decision] = await tx.insert(schema.resultDisqualificationDecisions).values({
        id: decisionId,
        requestId,
        actorCredentialId: authorization.principal.accessCredentialId,
        raceId: race.id,
        entryId: entry.id,
        expectedEntryVersion: request.data.expectedEntryVersion,
        expectedClassId: request.data.expectedClassId,
        expectedCourseVersionId: request.data.expectedCourseVersionId,
        expectedSnapshotVersion: request.data.expectedSnapshotVersion,
        targetResultRevisionId: latest.id,
        targetResultRevision: latest.revision,
        policyVersion: request.data.policyVersion,
        status: "DSQ",
        reason: "MANUAL_DISQUALIFICATION",
        createdResultRevisionId: resultRevisionId,
        createdResultRevision: createdRevision,
        decidedAt
      }).returning();
      if (!decision) throw new Error("Diskvalifikationsbeslutet kunde inte sparas");
      const [revision] = await tx.insert(schema.resultRevisions).values({
        id: resultRevisionId,
        raceId: race.id,
        entryId: entry.id,
        readoutId: null,
        didNotStartDecisionId: null,
        disqualificationDecisionId: decision.id,
        disqualificationWithdrawalId: null,
        revision: createdRevision,
        cause: "MANUAL_DISQUALIFICATION",
        status: outcome.status,
        reason: outcome.reason,
        evaluation: outcome,
        engineVersion: RESULT_DISQUALIFICATION_POLICY_VERSION,
        snapshotVersion: race.snapshotVersion,
        courseVersionId: raceClass.courseVersionId,
        controlNeutralizationId: latest.controlNeutralizationId,
        published: true,
        createdAt: decidedAt
      }).returning();
      if (!revision) throw new Error("Diskvalifikationens resultatrevision kunde inte sparas");
      await tx.insert(schema.auditEvents).values({
        raceId: race.id,
        entityType: "result_revision",
        entityId: revision.id,
        action: "RESULT_DISQUALIFIED",
        actorKind: authorization.principal.capability === "MANAGE_RACE"
          ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "RESULT_DISQUALIFICATION_ACCESS_CREDENTIAL",
        actorId: authorization.principal.accessCredentialId,
        requestId,
        before: { resultRevisionId: latest.id, revision: latest.revision, status: latest.status, reason: latest.reason },
        after: {
          entryId: entry.id,
          resultDisqualificationDecisionId: decision.id,
          resultRevisionId: revision.id,
          revision: revision.revision,
          status: revision.status,
          reason: revision.reason,
          policyVersion: decision.policyVersion,
          snapshotVersion: revision.snapshotVersion,
          courseVersionId: revision.courseVersionId
        }
      });
      return { status: "disqualified", response: responseFor(decision, revision, false) } as const;
    });
  } catch (error) {
    if (error instanceof StoredResultRevisionConflict) return { status: "conflict" };
    throw error;
  }
}

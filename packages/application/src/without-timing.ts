import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  WITHOUT_TIMING_DECISION_POLICY_VERSION,
  withoutTimingCandidateResponseSchema,
  withoutTimingIdempotencyKeySchema,
  withoutTimingRequestSchema,
  withoutTimingResponseSchema,
  type WithoutTimingCandidateResponse,
  type WithoutTimingRequest,
  type WithoutTimingResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { createWithoutTimingResult, WithoutTimingError } from "@o-tid/domain";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import {
  loadActiveManualResultOverrideState,
  resolveStoredResultHeadStates
} from "./result-revision-state";
import {
  parseWithoutTimingTechnicalRevision,
  StoredResultRevisionConflict,
  validateStoredWithoutTiming
} from "./stored-result-revision";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ENTRIES = 10_000;

type Decision = typeof schema.withoutTimingDecisions.$inferSelect;
type Revision = typeof schema.resultRevisions.$inferSelect;

export type WithoutTimingCandidateListResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; response: WithoutTimingCandidateResponse };

/** Lists bounded intent metadata only; no card, timing, split or evaluation facts leave the server. */
export async function listWithoutTimingCandidatesAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability">,
  now = new Date()
): Promise<WithoutTimingCandidateListResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "not-found" };
  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
        ...input,
        capability: "DECIDE_WITHOUT_TIMING"
      }, now);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
        .from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;

      const [entries, latest] = await Promise.all([
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
        tx.selectDistinctOn([schema.resultRevisions.entryId]).from(schema.resultRevisions)
          .where(eq(schema.resultRevisions.raceId, race.id))
          .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision),
            desc(schema.resultRevisions.id))
      ]);
      if (entries.length > MAX_ENTRIES) return { status: "conflict" } as const;

      const stateByEntry = new Map(
        (await resolveStoredResultHeadStates(tx, race.id, latest)).map((state) => [state.selectedHead.entryId, state])
      );
      const latestByEntry = new Map(latest.map((row) => [row.entryId, row]));
      const parsed = withoutTimingCandidateResponseSchema.safeParse({
        formatVersion: 1,
        raceId: race.id,
        snapshotVersion: race.snapshotVersion,
        policyVersion: WITHOUT_TIMING_DECISION_POLICY_VERSION,
        entries: entries.map((entry) => {
          const row = latestByEntry.get(entry.id);
          const state = stateByEntry.get(entry.id);
          let readiness: WithoutTimingCandidateResponse["entries"][number]["readiness"];
          let targetResultRevision: WithoutTimingCandidateResponse["entries"][number]["targetResultRevision"] = null;
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
          } else if (state?.state === "ACTIVE_RESULT" && state.head.didNotStartDecisionId !== null) {
            readiness = "ACTIVE_DID_NOT_START";
          } else if (!row || state?.state === "NO_ACTIVE_RESULT") {
            readiness = "NO_ACTIVE_RESULT";
          } else if (!row.published) {
            readiness = "UNPUBLISHED_RESULT";
          } else {
            try {
              const outcome = parseWithoutTimingTechnicalRevision(row);
              if (outcome.classId !== entry.classId || outcome.courseVersionId !== entry.courseVersionId ||
                  row.snapshotVersion !== race.snapshotVersion) {
                readiness = "STALE_RESULT";
              } else {
                readiness = "READY";
                targetResultRevision = {
                  id: row.id,
                  revision: row.revision,
                  status: outcome.status,
                  reason: outcome.reason,
                  cause: row.cause as "CARD_READOUT" | "CLASS_CHANGE_RECALCULATION" | "EXPLICIT_RECALCULATION" | "UNKNOWN_READOUT_RESOLUTION",
                  createdAt: row.createdAt.toISOString(),
                  snapshotVersion: row.snapshotVersion
                };
              }
            } catch (error) {
              if (!(error instanceof StoredResultRevisionConflict) && !(error instanceof WithoutTimingError)) throw error;
              readiness = "UNSUPPORTED_RESULT";
            }
          }
          return {
            id: entry.id,
            displayName: `${entry.givenName} ${entry.familyName}`,
            organisationName: entry.organisationName,
            classId: entry.classId,
            className: entry.className,
            courseVersionId: entry.courseVersionId,
            entryVersion: entry.entryVersion,
            readiness,
            targetResultRevision
          };
        })
      });
      return parsed.success ? { status: "ok", response: parsed.data } as const : { status: "conflict" } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredResultRevisionConflict || error instanceof WithoutTimingError) {
      return { status: "conflict" };
    }
    throw error;
  }
}

export type DecideWithoutTimingInput = Omit<PairingAdminRequestAuthentication, "capability"> & {
  entryId: string;
  idempotencyKey: string | null;
  request: unknown;
};

export type DecideWithoutTimingResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "without-timing"; response: WithoutTimingResponse };

function exactReplay(
  decision: Decision,
  actorCredentialId: string,
  raceId: string,
  entryId: string,
  request: WithoutTimingRequest
): boolean {
  return decision.actorCredentialId === actorCredentialId && decision.raceId === raceId &&
    decision.entryId === entryId && decision.expectedEntryVersion === request.expectedEntryVersion &&
    decision.expectedClassId === request.expectedClassId &&
    decision.expectedCourseVersionId === request.expectedCourseVersionId &&
    decision.expectedSnapshotVersion === request.expectedSnapshotVersion &&
    decision.targetResultRevisionId === request.expectedResultRevision.id &&
    decision.targetResultRevision === request.expectedResultRevision.revision &&
    request.expectedResultRevision.status === "OK" && request.expectedResultRevision.reason === "COMPLETE" &&
    decision.policyVersion === request.policyVersion;
}

function responseFor(decision: Decision, revision: Revision, replayed: boolean): WithoutTimingResponse {
  return withoutTimingResponseSchema.parse({
    formatVersion: 1,
    replayed,
    requestId: decision.requestId,
    raceId: decision.raceId,
    entryId: decision.entryId,
    withoutTimingDecisionId: decision.id,
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

export async function decideWithoutTimingAsAdmin(
  db: Database,
  input: DecideWithoutTimingInput,
  now = new Date()
): Promise<DecideWithoutTimingResult> {
  const key = withoutTimingIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = withoutTimingRequestSchema.safeParse(input.request);
  if (!key.success || !request.success || !UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.entryId)) {
    return { status: "invalid-request" };
  }
  const requestId = key.data.slice("without-timing:".length);
  const decidedAt = new Date(now);
  if (!Number.isFinite(decidedAt.getTime())) throw new Error("Beslutstiden är ogiltig");

  const preflight = await authenticatePairingAdminSession(db, {
    ...input,
    capability: "DECIDE_WITHOUT_TIMING",
    requireCsrf: true
  }, decidedAt);
  if (preflight.status !== "authenticated") return preflight;

  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForMutation(tx, {
        ...input,
        capability: "DECIDE_WITHOUT_TIMING",
        requireCsrf: true
      }, decidedAt);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
        .from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);

      const [existing] = await tx.select().from(schema.withoutTimingDecisions)
        .where(eq(schema.withoutTimingDecisions.requestId, requestId));
      if (existing) {
        if (!exactReplay(existing, authorization.principal.accessCredentialId, race.id, input.entryId, request.data)) {
          return { status: "conflict" } as const;
        }
        const [target, withoutTiming] = await Promise.all([
          tx.select().from(schema.resultRevisions)
            .where(eq(schema.resultRevisions.id, existing.targetResultRevisionId)).then((rows) => rows[0]),
          tx.select().from(schema.resultRevisions)
            .where(eq(schema.resultRevisions.id, existing.createdResultRevisionId)).then((rows) => rows[0])
        ]);
        if (!target || !withoutTiming) throw new Error("Utan-tidtagning-beslutets revisioner saknas");
        validateStoredWithoutTiming(existing, target, withoutTiming);
        return { status: "without-timing", response: responseFor(existing, withoutTiming, true) } as const;
      }

      const [entry] = await tx.select().from(schema.entries).where(and(
        eq(schema.entries.id, input.entryId),
        eq(schema.entries.raceId, race.id)
      )).for("update");
      if (!entry) return { status: "not-found" } as const;
      if (entry.version !== request.data.expectedEntryVersion || entry.classId !== request.data.expectedClassId ||
          race.snapshotVersion !== request.data.expectedSnapshotVersion ||
          request.data.policyVersion !== WITHOUT_TIMING_DECISION_POLICY_VERSION) {
        return { status: "conflict" } as const;
      }
      const [raceClass] = await tx.select({ courseVersionId: schema.classes.courseVersionId })
        .from(schema.classes).where(and(eq(schema.classes.id, entry.classId), eq(schema.classes.raceId, race.id)));
      if (!raceClass || raceClass.courseVersionId !== request.data.expectedCourseVersionId) {
        return { status: "conflict" } as const;
      }
      const [target] = await tx.select().from(schema.resultRevisions).where(and(
        eq(schema.resultRevisions.raceId, race.id),
        eq(schema.resultRevisions.entryId, entry.id)
      )).orderBy(desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id)).limit(1);
      if (!target || target.id !== request.data.expectedResultRevision.id ||
          target.revision !== request.data.expectedResultRevision.revision ||
          target.status !== request.data.expectedResultRevision.status ||
          target.reason !== request.data.expectedResultRevision.reason) {
        return { status: "conflict" } as const;
      }
      if (await loadActiveManualResultOverrideState(tx, race.id, target) !== "NONE") {
        return { status: "conflict" } as const;
      }
      const source = parseWithoutTimingTechnicalRevision(target);
      if (source.status !== "OK" || source.reason !== "COMPLETE" || source.classId !== entry.classId ||
          source.courseVersionId !== raceClass.courseVersionId || target.snapshotVersion !== race.snapshotVersion) {
        return { status: "conflict" } as const;
      }

      const outcome = createWithoutTimingResult(source);
      const decisionId = randomUUID();
      const resultRevisionId = randomUUID();
      const createdRevision = target.revision + 1;
      const [decision] = await tx.insert(schema.withoutTimingDecisions).values({
        id: decisionId,
        requestId,
        actorCredentialId: authorization.principal.accessCredentialId,
        raceId: race.id,
        entryId: entry.id,
        expectedEntryVersion: request.data.expectedEntryVersion,
        expectedClassId: request.data.expectedClassId,
        expectedCourseVersionId: request.data.expectedCourseVersionId,
        expectedSnapshotVersion: request.data.expectedSnapshotVersion,
        targetResultRevisionId: target.id,
        targetResultRevision: target.revision,
        policyVersion: request.data.policyVersion,
        status: "NT",
        reason: "WITHOUT_TIMING",
        createdResultRevisionId: resultRevisionId,
        createdResultRevision: createdRevision,
        decidedAt
      }).returning();
      if (!decision) throw new Error("Utan-tidtagning-beslutet kunde inte sparas");
      const [withoutTiming] = await tx.insert(schema.resultRevisions).values({
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
        didNotFinishWithdrawalId: null,
        notCompetingDecisionId: null,
        notCompetingWithdrawalId: null,
        withoutTimingDecisionId: decision.id,
        revision: createdRevision,
        cause: "MANUAL_WITHOUT_TIMING",
        status: outcome.status,
        reason: outcome.reason,
        evaluation: outcome,
        engineVersion: WITHOUT_TIMING_DECISION_POLICY_VERSION,
        snapshotVersion: race.snapshotVersion,
        courseVersionId: raceClass.courseVersionId,
        controlNeutralizationId: target.controlNeutralizationId,
        published: true,
        createdAt: decidedAt
      }).returning();
      if (!withoutTiming) throw new Error("Utan-tidtagning-revisionen kunde inte sparas");
      await tx.insert(schema.auditEvents).values({
        raceId: race.id,
        entityType: "result_revision",
        entityId: withoutTiming.id,
        action: "WITHOUT_TIMING_DECIDED",
        actorKind: authorization.principal.capability === "MANAGE_RACE"
          ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "WITHOUT_TIMING_ACCESS_CREDENTIAL",
        actorId: authorization.principal.accessCredentialId,
        requestId,
        before: {
          resultRevisionId: target.id,
          revision: target.revision,
          status: target.status,
          reason: target.reason
        },
        after: {
          entryId: entry.id,
          withoutTimingDecisionId: decision.id,
          resultRevisionId: withoutTiming.id,
          revision: withoutTiming.revision,
          status: withoutTiming.status,
          reason: withoutTiming.reason,
          policyVersion: decision.policyVersion,
          snapshotVersion: withoutTiming.snapshotVersion,
          courseVersionId: withoutTiming.courseVersionId
        }
      });
      return { status: "without-timing", response: responseFor(decision, withoutTiming, false) } as const;
    });
  } catch (error) {
    if (error instanceof StoredResultRevisionConflict || error instanceof WithoutTimingError) {
      return { status: "conflict" };
    }
    throw error;
  }
}

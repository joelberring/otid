import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import {
  canonicalJsonBytes,
  manualCourseResultBearingRelinkCandidateSchema,
  manualCourseResultBearingRelinkIdempotencyKeySchema,
  manualCourseResultBearingRelinkRequestSchema,
  manualCourseResultBearingRelinkResponseSchema,
  type ManualCourseResultBearingRelinkCandidate
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { StoredResultRevisionConflict } from "./stored-result-revision";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ENTRIES = 10_000;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Input = Omit<PairingAdminRequestAuthentication, "capability"> & { idempotencyKey: string | null; request: unknown };
type CandidateInput = Omit<PairingAdminRequestAuthentication, "capability"> & { classId: string };
type ResolvedHead = Awaited<ReturnType<typeof resolveStoredResultHeadStates>>[number];

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

function isShortenedCoursePrefix(current: readonly number[], proposed: readonly number[]): boolean {
  return proposed.length > 0 && proposed.length < current.length &&
    proposed.every((code, index) => code === current[index]);
}

function effectiveManualDecision(state: ResolvedHead) {
  if (state.startCheckinDns?.correction === null) {
    const source = state.startCheckinDns.source;
    return { kind: "CHECKIN_DNS" as const, decisionId: source.decision.id,
      createdResultRevisionId: source.result.id, createdResultRevision: source.result.revision };
  }
  if (state.head.didNotStartDecisionId !== null && state.state === "ACTIVE_RESULT") {
    return { kind: "DNS" as const, decisionId: state.head.didNotStartDecisionId,
      createdResultRevisionId: state.head.id, createdResultRevision: state.head.revision };
  }
  if (state.disqualification?.withdrawal === null) return { kind: "DSQ" as const,
    decisionId: state.disqualification.decision.id, createdResultRevisionId: state.disqualification.disqualified.id,
    createdResultRevision: state.disqualification.disqualified.revision };
  if (state.approval?.withdrawal === null) return { kind: "APPROVAL" as const,
    decisionId: state.approval.decision.id, createdResultRevisionId: state.approval.approved.id,
    createdResultRevision: state.approval.approved.revision };
  if (state.didNotFinish?.withdrawal === null) return { kind: "DNF" as const,
    decisionId: state.didNotFinish.decision.id, createdResultRevisionId: state.didNotFinish.didNotFinish.id,
    createdResultRevision: state.didNotFinish.didNotFinish.revision };
  if (state.notCompeting?.withdrawal === null) return { kind: "OOC" as const,
    decisionId: state.notCompeting.decision.id, createdResultRevisionId: state.notCompeting.outOfCompetition.id,
    createdResultRevision: state.notCompeting.outOfCompetition.revision };
  if (state.withoutTiming?.withdrawal === null) return { kind: "NT" as const,
    decisionId: state.withoutTiming.decision.id, createdResultRevisionId: state.withoutTiming.withoutTiming.id,
    createdResultRevision: state.withoutTiming.withoutTiming.revision };
  return null;
}

async function buildBasis(tx: Transaction, raceId: string, classId: string): Promise<
  | { status: "not-found" | "too-large" }
  | { status: "ok"; candidate: ManualCourseResultBearingRelinkCandidate; frozenBasis: Record<string, unknown> }
> {
  const [current] = await tx.select({
    snapshotVersion: schema.races.snapshotVersion, courseId: schema.courses.id, courseName: schema.courses.name, className: schema.classes.name,
    classCourseVersionId: schema.courseVersions.id, classCourseVersion: schema.courseVersions.version
  }).from(schema.classes).innerJoin(schema.races, eq(schema.races.id, schema.classes.raceId))
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
    .innerJoin(schema.courses, and(eq(schema.courses.id, schema.courseVersions.courseId), eq(schema.courses.raceId, schema.races.id)))
    .where(and(eq(schema.classes.id, classId), eq(schema.classes.raceId, raceId),
      isNull(schema.classes.externalSource), isNull(schema.classes.externalId),
      isNull(schema.courses.externalSource), isNull(schema.courses.externalId)));
  if (!current) return { status: "not-found" };
  const controls = await tx.select({ code: schema.controls.code }).from(schema.courseControls)
    .innerJoin(schema.controls, eq(schema.controls.id, schema.courseControls.controlId))
    .where(eq(schema.courseControls.courseVersionId, current.classCourseVersionId)).orderBy(asc(schema.courseControls.sequence));
  if (controls.length === 0) return { status: "not-found" };
  const entries = await tx.select({ id: schema.entries.id, version: schema.entries.version }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.classId, classId))).orderBy(asc(schema.entries.id)).limit(MAX_ENTRIES + 1);
  if (entries.length > MAX_ENTRIES) return { status: "too-large" };
  const entryIds = entries.map(entry => entry.id);
  const [historical] = await tx.select({ value: count() }).from(schema.resultRevisions).innerJoin(schema.entries,
    and(eq(schema.entries.id, schema.resultRevisions.entryId), eq(schema.entries.raceId, schema.resultRevisions.raceId)))
    .where(and(eq(schema.resultRevisions.raceId, raceId), eq(schema.entries.classId, classId)));
  const latest = entryIds.length === 0 ? [] : await tx.selectDistinctOn([schema.resultRevisions.entryId]).from(schema.resultRevisions)
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, entryIds)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id));
  const stateByEntry = new Map((await resolveStoredResultHeadStates(tx, raceId, latest)).map(state => [state.head.entryId, state]));
  const latestByEntry = new Map(latest.map(row => [row.entryId, row]));
  const basisEntries = entries.map(entry => {
    const head = latestByEntry.get(entry.id) ?? null;
    return {
      entryId: entry.id, entryVersion: entry.version,
      latestResultRevision: head === null ? null : {
        id: head.id, revision: head.revision, courseVersionId: head.courseVersionId,
        snapshotVersion: head.snapshotVersion, published: head.published,
        status: head.status, reason: head.reason, cause: head.cause
      },
      effectiveManualDecision: head === null ? null : effectiveManualDecision(stateByEntry.get(entry.id)!)
    };
  });
  const semanticBasis = {
    formatVersion: 1 as const, raceId, snapshotVersion: current.snapshotVersion, classId, courseId: current.courseId,
    classCourseVersionId: current.classCourseVersionId, classCourseVersion: current.classCourseVersion,
    historicalResultRevisionCount: Number(historical?.value ?? 0), entries: basisEntries
  };
  const frozenBasis = { kind: "MANUAL_COURSE_RESULT_BEARING_RELINK_BASIS", ...semanticBasis };
  const candidate = manualCourseResultBearingRelinkCandidateSchema.parse({ ...semanticBasis, basisHash: sha256(frozenBasis),
    courseName: current.courseName, className: current.className, currentControlCodes: controls.map(control => control.code) });
  return { status: "ok", candidate, frozenBasis };
}

export type ManualCourseResultBearingRelinkCandidateResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "too-large" }
  | { status: "ok"; response: ManualCourseResultBearingRelinkCandidate };

export async function previewManualCourseResultBearingRelinkAsAdministrator(
  db: Database, input: CandidateInput, now = new Date()
): Promise<ManualCourseResultBearingRelinkCandidateResult> {
  if (!uuid.test(input.raceId) || !uuid.test(input.classId)) return { status: "invalid-request" };
  try {
    return await db.transaction(async tx => {
      const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability: "MANAGE_RACE" }, now);
      if (authorization.status !== "authenticated") return authorization;
      const basis = await buildBasis(tx, authorization.principal.raceId, input.classId);
      return basis.status === "ok" ? { status: "ok", response: basis.candidate } : basis;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredResultRevisionConflict) return { status: "not-found" };
    throw error;
  }
}

export type ManualCourseResultBearingRelinkResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "too-large" | "conflict" }
  | { status: "changed"; response: ReturnType<typeof manualCourseResultBearingRelinkResponseSchema.parse> };

export async function relinkManualCourseResultBearingClassAsAdministrator(
  db: Database, input: Input, now = new Date()
): Promise<ManualCourseResultBearingRelinkResult> {
  const parsed = manualCourseResultBearingRelinkRequestSchema.safeParse(input.request);
  const key = manualCourseResultBearingRelinkIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data.slice("manual-course-result-bearing-link:".length) !== parsed.data.requestId || !uuid.test(input.raceId)) return { status: "invalid-request" };
  const intent = parsed.data;
  const authentication = { ...input, capability: "MANAGE_RACE" as const, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  return db.transaction(async tx => {
    const authorization = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (authorization.status !== "authenticated") return authorization;
    const race = await lockRaceForMutation(tx, authorization.principal.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"manual-course-result-bearing-link:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.manualCourseResultBearingRelinkRequests)
      .where(eq(schema.manualCourseResultBearingRelinkRequests.requestId, intent.requestId));
    if (prior) {
      const original = manualCourseResultBearingRelinkRequestSchema.parse(prior.request);
      const response = manualCourseResultBearingRelinkResponseSchema.parse(prior.response);
      if (prior.raceId !== race.id || prior.actorCredentialId !== authorization.principal.accessCredentialId ||
          JSON.stringify(original) !== JSON.stringify(intent) || response.replayed || response.requestId !== intent.requestId ||
          prior.sourceHash !== response.sourceBasisHash ||
          prior.sourceSnapshotVersion !== response.sourceSnapshotVersion || JSON.stringify(response.request) !== JSON.stringify(original)) return { status: "conflict" };
      return { status: "changed", response: { ...response, replayed: true } };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= 2_147_483_647) return { status: "conflict" };
    const basis = await buildBasis(tx, race.id, intent.classId);
    if (basis.status !== "ok") return basis;
    if (basis.candidate.courseId !== intent.courseId || basis.candidate.classCourseVersionId !== intent.expectedClassCourseVersionId ||
        basis.candidate.snapshotVersion !== intent.expectedSnapshotVersion || basis.candidate.basisHash !== intent.expectedBasisHash) return { status: "conflict" };
    if (basis.candidate.historicalResultRevisionCount > 0 &&
        isShortenedCoursePrefix(basis.candidate.currentControlCodes, intent.controlCodes)) {
      return { status: "invalid-request" };
    }
    const [latest] = await tx.select({ version: max(schema.courseVersions.version) }).from(schema.courseVersions)
      .where(eq(schema.courseVersions.courseId, intent.courseId));
    const nextVersion = (latest?.version ?? 0) + 1;
    if (nextVersion <= basis.candidate.classCourseVersion || nextVersion > 2_147_483_647) return { status: "conflict" };
    const [courseVersion] = await tx.insert(schema.courseVersions).values({ courseId: intent.courseId, version: nextVersion }).returning();
    if (!courseVersion) throw new Error("Banversionen kunde inte skapas");
    for (const [index, code] of intent.controlCodes.entries()) {
      await tx.insert(schema.controls).values({ raceId: race.id, code }).onConflictDoNothing();
      const [control] = await tx.select({ id: schema.controls.id }).from(schema.controls)
        .where(and(eq(schema.controls.raceId, race.id), eq(schema.controls.code, code)));
      if (!control) throw new Error("Kontrollen kunde inte skapas");
      await tx.insert(schema.courseControls).values({ courseVersionId: courseVersion.id, controlId: control.id, sequence: index + 1 });
    }
    const response = manualCourseResultBearingRelinkResponseSchema.parse({
      formatVersion: 1, replayed: false, requestId: intent.requestId, raceId: race.id, courseId: intent.courseId, classId: intent.classId,
      previousCourseVersionId: basis.candidate.classCourseVersionId, previousCourseVersion: basis.candidate.classCourseVersion,
      courseVersionId: courseVersion.id, courseVersion: courseVersion.version,
      sourceSnapshotVersion: race.snapshotVersion, sourceBasisHash: basis.candidate.basisHash, request: intent,
      entryCount: basis.candidate.entries.length, historicalResultRevisionCount: basis.candidate.historicalResultRevisionCount,
      snapshotVersionAfter: race.snapshotVersion + 1, changedAt: now.toISOString()
    });
    await tx.update(schema.classes).set({ courseVersionId: courseVersion.id }).where(and(eq(schema.classes.id, intent.classId), eq(schema.classes.raceId, race.id)));
    await tx.update(schema.races).set({ snapshotVersion: response.snapshotVersionAfter }).where(eq(schema.races.id, race.id));
    await tx.insert(schema.manualCourseResultBearingRelinkRequests).values({
      requestId: intent.requestId, raceId: race.id, courseId: intent.courseId, classId: intent.classId,
      previousCourseVersionId: basis.candidate.classCourseVersionId, courseVersionId: courseVersion.id,
      actorCredentialId: authorization.principal.accessCredentialId, capability: "MANAGE_RACE",
      sourceSnapshotVersion: race.snapshotVersion, sourceHash: basis.candidate.basisHash,
      frozenBasis: basis.frozenBasis, request: intent, response, changedAt: now
    });
    await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "class", entityId: intent.classId,
      requestId: intent.requestId, actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: authorization.principal.accessCredentialId,
      action: "MANUAL_COURSE_RESULT_BEARING_VERSION_LINKED_BY_ADMIN",
      before: { courseId: intent.courseId, courseVersionId: basis.candidate.classCourseVersionId, snapshotVersion: race.snapshotVersion, basisHash: basis.candidate.basisHash },
      after: { courseVersionId: courseVersion.id, courseVersion: courseVersion.version, controlCodes: intent.controlCodes,
        snapshotVersion: response.snapshotVersionAfter, historicalResultRevisionCount: basis.candidate.historicalResultRevisionCount }, createdAt: now });
    return { status: "changed", response };
  });
}

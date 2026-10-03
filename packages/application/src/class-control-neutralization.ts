import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  canonicalJsonBytes,
  classControlNeutralizationCandidateSchema,
  classControlNeutralizationIdempotencyKeySchema,
  classControlNeutralizationRequestSchema,
  classControlNeutralizationResponseSchema,
  type ClassControlNeutralizationCandidate,
  type ClassControlNeutralizationResponse
} from "@o-tid/contracts";
import type { EvaluationResult, RaceSnapshot } from "@o-tid/domain";
import { schema, type Database } from "@o-tid/database";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type CandidateInput = Omit<PairingAdminRequestAuthentication, "capability"> & { classId: string };
type CommitInput = Omit<PairingAdminRequestAuthentication, "capability"> & { idempotencyKey: string | null; request: unknown };

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

async function basis(tx: Transaction, raceId: string, classId: string, now: Date): Promise<
  | { status: "not-found" | "conflict" }
  | { status: "ok"; candidate: ClassControlNeutralizationCandidate }
> {
  const [raceClass] = await tx.select({ className: schema.classes.name, courseVersionId: schema.classes.courseVersionId,
    snapshotVersion: schema.races.snapshotVersion, courseVersion: schema.courseVersions.version
  }).from(schema.classes).innerJoin(schema.races, eq(schema.races.id, schema.classes.raceId))
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
    .where(and(eq(schema.classes.id, classId), eq(schema.classes.raceId, raceId)));
  if (!raceClass) return { status: "not-found" };
  const [existing] = await tx.select({ id: schema.classControlNeutralizations.id })
    .from(schema.classControlNeutralizations)
    .where(and(eq(schema.classControlNeutralizations.classId, classId),
      eq(schema.classControlNeutralizations.courseVersionId, raceClass.courseVersionId))).limit(1);
  if (existing) return { status: "conflict" };
  const controls = await tx.select({ id: schema.courseControls.id, sequence: schema.courseControls.sequence,
    controlCode: schema.controls.code
  }).from(schema.courseControls).innerJoin(schema.controls, eq(schema.controls.id, schema.courseControls.controlId))
    .where(eq(schema.courseControls.courseVersionId, raceClass.courseVersionId))
    .orderBy(asc(schema.courseControls.sequence), asc(schema.courseControls.id)).limit(1_001);
  if (controls.length === 0 || controls.length > 1_000 || controls.some((control, index) => control.sequence !== index + 1)) {
    return { status: "conflict" };
  }
  const entries = await tx.select({ id: schema.entries.id, version: schema.entries.version })
    .from(schema.entries).where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.classId, classId)))
    .orderBy(asc(schema.entries.id)).limit(10_001);
  if (entries.length > 10_000) return { status: "conflict" };
  const entryIds = entries.map((entry) => entry.id);
  const [historical] = await tx.select({ value: count() }).from(schema.resultRevisions)
    .innerJoin(schema.entries, and(eq(schema.entries.id, schema.resultRevisions.entryId),
      eq(schema.entries.raceId, schema.resultRevisions.raceId)))
    .where(and(eq(schema.resultRevisions.raceId, raceId), eq(schema.entries.classId, classId)));
  const heads = entryIds.length === 0 ? [] : await tx.selectDistinctOn([schema.resultRevisions.entryId], {
    entryId: schema.resultRevisions.entryId, id: schema.resultRevisions.id, revision: schema.resultRevisions.revision,
    cause: schema.resultRevisions.cause, status: schema.resultRevisions.status, reason: schema.resultRevisions.reason,
    courseVersionId: schema.resultRevisions.courseVersionId, snapshotVersion: schema.resultRevisions.snapshotVersion,
    published: schema.resultRevisions.published, controlNeutralizationId: schema.resultRevisions.controlNeutralizationId
  }).from(schema.resultRevisions).where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, entryIds)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id));
  const headByEntry = new Map(heads.map((head) => [head.entryId, head]));
  const frozenBasis = { kind: "CLASS_CONTROL_NEUTRALIZATION_BASIS", raceId, classId,
    snapshotVersion: raceClass.snapshotVersion, courseVersionId: raceClass.courseVersionId,
    courseVersion: raceClass.courseVersion, controls,
    entries: entries.map((entry) => ({ id: entry.id, version: entry.version, latestResult: headByEntry.get(entry.id) ?? null })) };
  return { status: "ok", candidate: classControlNeutralizationCandidateSchema.parse({ formatVersion: 1, raceId, classId,
    className: raceClass.className, courseVersionId: raceClass.courseVersionId, courseVersion: raceClass.courseVersion,
    snapshotVersion: raceClass.snapshotVersion, basisHash: hash(frozenBasis), controls,
    historicalResultRevisionCount: Number(historical?.value ?? 0), generatedAt: now.toISOString() }) };
}

export type ClassControlNeutralizationCandidateResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; response: ClassControlNeutralizationCandidate };

export async function previewClassControlNeutralizationAsAdministrator(
  db: Database, input: CandidateInput, now = new Date()
): Promise<ClassControlNeutralizationCandidateResult> {
  if (!UUID.test(input.raceId) || !UUID.test(input.classId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability: "MANAGE_RACE" }, now);
    if (auth.status !== "authenticated") return auth;
    const value = await basis(tx, auth.principal.raceId, input.classId, now);
    return value.status === "ok" ? { status: "ok", response: value.candidate } : value;
  }, { isolationLevel: "repeatable read" });
}

export type ClassControlNeutralizationCommitResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "changed"; response: ClassControlNeutralizationResponse };

export async function neutralizeClassControlAsAdministrator(
  db: Database, input: CommitInput, now = new Date()
): Promise<ClassControlNeutralizationCommitResult> {
  const request = classControlNeutralizationRequestSchema.safeParse(input.request);
  const idempotencyKey = classControlNeutralizationIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!request.success || !idempotencyKey.success || idempotencyKey.data !== `class-control-neutralization:${request.data.requestId}` ||
      !UUID.test(input.raceId)) return { status: "invalid-request" };
  const authentication = { ...input, capability: "MANAGE_RACE" as const, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, auth.principal.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"class-control-neutralization:" + request.data.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.classControlNeutralizations)
      .where(eq(schema.classControlNeutralizations.id, request.data.requestId));
    if (prior) {
      const original = classControlNeutralizationRequestSchema.safeParse(prior.request);
      const response = classControlNeutralizationResponseSchema.safeParse(prior.response);
      if (!original.success || !response.success || prior.raceId !== race.id || prior.actorCredentialId !== auth.principal.accessCredentialId ||
          JSON.stringify(original.data) !== JSON.stringify(request.data) || response.data.requestId !== prior.id ||
          response.data.neutralizationId !== prior.id || response.data.replayed) return { status: "conflict" };
      return { status: "changed", response: { ...response.data, replayed: true } };
    }
    if (race.snapshotVersion !== request.data.expectedSnapshotVersion || race.snapshotVersion >= 2_147_483_647) return { status: "conflict" };
    const current = await basis(tx, race.id, request.data.classId, now);
    if (current.status !== "ok" || current.candidate.snapshotVersion !== request.data.expectedSnapshotVersion ||
        current.candidate.basisHash !== request.data.expectedBasisHash ||
        current.candidate.courseVersionId !== request.data.expectedCourseVersionId) return { status: "conflict" };
    const control = current.candidate.controls.find((value) => value.id === request.data.courseControlId &&
      value.sequence === request.data.sequence && value.controlCode === request.data.controlCode);
    if (!control) return { status: "conflict" };
    const response = classControlNeutralizationResponseSchema.parse({ formatVersion: 1, replayed: false,
      requestId: request.data.requestId, neutralizationId: request.data.requestId, raceId: race.id,
      classId: request.data.classId, courseVersionId: request.data.expectedCourseVersionId,
      courseControlId: control.id, sequence: control.sequence, controlCode: control.controlCode,
      sourceSnapshotVersion: race.snapshotVersion, sourceBasisHash: current.candidate.basisHash,
      snapshotVersionAfter: race.snapshotVersion + 1, request: request.data,
      historicalResultRevisionCount: current.candidate.historicalResultRevisionCount, neutralizedAt: now.toISOString() });
    await tx.insert(schema.classControlNeutralizations).values({ id: response.neutralizationId, raceId: race.id,
      classId: response.classId, courseVersionId: response.courseVersionId, courseControlId: response.courseControlId,
      sequence: response.sequence, controlCode: response.controlCode, actorCredentialId: auth.principal.accessCredentialId,
      capability: "MANAGE_RACE", expectedSnapshotVersion: response.sourceSnapshotVersion,
      basisHash: response.sourceBasisHash, request: request.data, response, createdAt: now });
    await tx.update(schema.races).set({ snapshotVersion: response.snapshotVersionAfter }).where(eq(schema.races.id, race.id));
    await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "class", entityId: response.classId,
      requestId: response.requestId, actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      action: "CLASS_CONTROL_NEUTRALIZED_BY_ADMIN", before: { snapshotVersion: race.snapshotVersion, basisHash: response.sourceBasisHash },
      after: { courseVersionId: response.courseVersionId, courseControlId: response.courseControlId,
        sequence: response.sequence, controlCode: response.controlCode, snapshotVersion: response.snapshotVersionAfter }, createdAt: now });
    return { status: "changed", response };
  });
}

/** Provenance for direct technical writers; never derives an historical rule. */
export function appliedControlNeutralization(snapshot: RaceSnapshot, evaluation: EvaluationResult): string | null {
  if (!evaluation.classId || !evaluation.courseVersionId) return null;
  const matches = snapshot.classControlNeutralizations.filter((candidate) => candidate.classId === evaluation.classId && candidate.courseVersionId === evaluation.courseVersionId);
  if (matches.length > 1) throw new Error("Flera neutraliseringar matchar resultatet");
  return matches[0]?.id ?? null;
}

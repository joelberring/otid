import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  canonicalJsonBytes,
  shortenedCourseClassTransferCandidateSchema,
  shortenedCourseClassTransferIdempotencyKeySchema,
  shortenedCourseClassTransferPreviewRequestSchema,
  shortenedCourseClassTransferReceiptSchema,
  shortenedCourseClassTransferRequestSchema,
  type ShortenedCourseClassTransferCandidate,
  type ShortenedCourseClassTransferReceipt
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { evaluateCardReadout, RESULT_ENGINE_VERSION, type NormalizedCardReadout } from "@o-tid/domain";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { loadRaceSnapshot } from "./snapshot";
import { parseStrictStoredResultRevision, StoredResultRevisionConflict } from "./stored-result-revision";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxVersion = 2_147_483_647;
const maxEntries = 10_000;
const maxControls = 1_000;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
type PreviewInput = Authentication & { request: unknown };
type CommitInput = Authentication & { idempotencyKey: string | null; request: unknown };

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

function canonicalEquals(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalJsonBytes(left);
  const rightBytes = canonicalJsonBytes(right);
  return leftBytes.length === rightBytes.length && leftBytes.every((value, index) => value === rightBytes[index]);
}

function exactFixedStartTime(value: Date | null): boolean {
  return value === null || value.toISOString() === new Date(Math.trunc(value.getTime())).toISOString();
}

type BuiltBasis = { readonly candidate: ShortenedCourseClassTransferCandidate; readonly frozenBasis: Record<string, unknown> };

async function buildBasis(tx: Transaction, raceId: string, sourceClassId: string): Promise<
  | { status: "not-found" | "too-large" }
  | { status: "ok"; value: BuiltBasis }
> {
  const [current] = await tx.select({
    snapshotVersion: schema.races.snapshotVersion,
    sourceClassId: schema.classes.id, sourceClassName: schema.classes.name, sourceStartRule: schema.classes.startRule,
    sourceCourseId: schema.courses.id, sourceCourseName: schema.courses.name,
    sourceCourseVersionId: schema.courseVersions.id, sourceCourseVersion: schema.courseVersions.version
  }).from(schema.classes).innerJoin(schema.races, eq(schema.races.id, schema.classes.raceId))
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
    .innerJoin(schema.courses, and(eq(schema.courses.id, schema.courseVersions.courseId), eq(schema.courses.raceId, schema.races.id)))
    .where(and(eq(schema.classes.id, sourceClassId), eq(schema.classes.raceId, raceId)));
  if (!current) return { status: "not-found" };
  const controls = await tx.select({ courseControlId: schema.courseControls.id, sequence: schema.courseControls.sequence,
    controlCode: schema.controls.code }).from(schema.courseControls).innerJoin(schema.controls, eq(schema.controls.id, schema.courseControls.controlId))
    .where(eq(schema.courseControls.courseVersionId, current.sourceCourseVersionId))
    .orderBy(asc(schema.courseControls.sequence), asc(schema.courseControls.id)).limit(maxControls + 1);
  if (controls.length > maxControls) return { status: "too-large" };
  if (controls.length < 2 || controls.some((control, index) => control.sequence !== index + 1)) return { status: "not-found" };
  const entries = await tx.select({ id: schema.entries.id, classId: schema.entries.classId, version: schema.entries.version,
    givenName: schema.entries.givenName, familyName: schema.entries.familyName, fixedStartTime: schema.entries.fixedStartTime,
    exactTime: sql<boolean>`${schema.entries.fixedStartTime} IS NULL OR date_trunc('milliseconds', ${schema.entries.fixedStartTime}) = ${schema.entries.fixedStartTime}`
  }).from(schema.entries).where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.classId, sourceClassId)))
    .orderBy(asc(schema.entries.id)).limit(maxEntries + 1);
  if (entries.length > maxEntries) return { status: "too-large" };
  if (entries.some((entry) => !entry.exactTime || !exactFixedStartTime(entry.fixedStartTime) ||
      (current.sourceStartRule === "FIXED") !== (entry.fixedStartTime !== null))) return { status: "not-found" };
  const entryIds = entries.map((entry) => entry.id);
  const heads = entryIds.length === 0 ? [] : await tx.selectDistinctOn([schema.resultRevisions.entryId]).from(schema.resultRevisions)
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, entryIds)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id));
  const headByEntry = new Map(heads.map((head) => [head.entryId, head]));
  let states;
  try {
    states = await resolveStoredResultHeadStates(tx, raceId, heads);
  } catch (error) {
    if (error instanceof StoredResultRevisionConflict) return { status: "not-found" };
    throw error;
  }
  const stateByEntry = new Map(states.map((state) => [state.selectedHead.entryId, state]));
  const eligibleEntries: Array<ShortenedCourseClassTransferCandidate["entries"][number]> = [];
  for (const entry of entries) {
    const head = headByEntry.get(entry.id);
    if (!head) {
      eligibleEntries.push({ entryId: entry.id, entryVersion: entry.version, displayName: `${entry.givenName} ${entry.familyName}`,
        startRule: current.sourceStartRule, fixedStartTime: entry.fixedStartTime?.toISOString() ?? null, sourceResult: { kind: "NO_RESULT" } });
      continue;
    }
    const state = stateByEntry.get(entry.id);
    if (!state || state.state !== "ACTIVE_RESULT" || head.cause !== "CARD_READOUT" || !head.published || head.status !== "MP" ||
        head.readoutId === null || head.courseVersionId !== current.sourceCourseVersionId || head.shortenedCourseClassTransferId !== null) continue;
    try {
      parseStrictStoredResultRevision(head, state.startCheckinDns?.source,
        state.finishTimeCorrection ?? undefined, state.finishTimeCorrectionWithdrawal ?? undefined,
        state.punchStartTimeCorrection ?? undefined, state.punchStartTimeCorrectionWithdrawal ?? undefined,
        state.shortenedCourseClassTransfer ?? undefined);
    } catch (error) {
      if (error instanceof StoredResultRevisionConflict) continue;
      throw error;
    }
    eligibleEntries.push({ entryId: entry.id, entryVersion: entry.version, displayName: `${entry.givenName} ${entry.familyName}`,
      startRule: current.sourceStartRule, fixedStartTime: entry.fixedStartTime?.toISOString() ?? null,
      sourceResult: { kind: "CARD_READOUT_MP", resultRevisionId: head.id, resultRevision: head.revision,
        readoutId: head.readoutId, snapshotVersion: head.snapshotVersion, courseVersionId: head.courseVersionId,
        status: "MP", cause: "CARD_READOUT", published: true } });
  }
  const semantic = { formatVersion: 1 as const, raceId, sourceClassId: current.sourceClassId, sourceClassName: current.sourceClassName,
    sourceCourseId: current.sourceCourseId, sourceCourseName: current.sourceCourseName,
    sourceCourseVersionId: current.sourceCourseVersionId, sourceCourseVersion: current.sourceCourseVersion,
    sourceStartRule: current.sourceStartRule, snapshotVersion: current.snapshotVersion, sourceControls: controls, entries: eligibleEntries };
  const frozenBasis = { kind: "SHORTENED_COURSE_CLASS_TRANSFER_BASIS", semantic };
  return { status: "ok", value: { frozenBasis,
    candidate: shortenedCourseClassTransferCandidateSchema.parse({ ...semantic, basisHash: sha256(frozenBasis) }) } };
}

export type ShortenedCourseClassTransferPreviewResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "too-large" }
  | { status: "ok"; response: ShortenedCourseClassTransferCandidate };

export async function previewShortenedCourseClassTransferAsAdministrator(
  db: Database, input: PreviewInput, now = new Date()
): Promise<ShortenedCourseClassTransferPreviewResult> {
  const request = shortenedCourseClassTransferPreviewRequestSchema.safeParse(input.request);
  if (!request.success || !uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability: "MANAGE_RACE" }, now);
    if (auth.status !== "authenticated") return auth;
    await lockRaceForSnapshot(tx, auth.principal.raceId);
    const basis = await buildBasis(tx, auth.principal.raceId, request.data.sourceClassId);
    return basis.status === "ok" ? { status: "ok", response: basis.value.candidate } : basis;
  }, { isolationLevel: "repeatable read" });
}

export type ShortenedCourseClassTransferResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "too-large" | "conflict" }
  | { status: "transferred"; response: ShortenedCourseClassTransferReceipt };

export async function transferShortenedCourseClassAsAdministrator(
  db: Database, input: CommitInput, now = new Date()
): Promise<ShortenedCourseClassTransferResult> {
  const request = shortenedCourseClassTransferRequestSchema.safeParse(input.request);
  const key = shortenedCourseClassTransferIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!request.success || !key.success || !uuid.test(input.raceId) ||
      key.data.slice("shortened-course-class-transfer:".length) !== request.data.requestId) return { status: "invalid-request" };
  const intent = request.data;
  const authentication = { ...input, capability: "MANAGE_RACE" as const, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, auth.principal.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"shortened-course-class-transfer:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.shortenedCourseClassTransfers)
      .where(eq(schema.shortenedCourseClassTransfers.requestId, intent.requestId));
    if (prior) {
      const storedRequest = shortenedCourseClassTransferRequestSchema.safeParse(prior.request);
      const storedReceipt = shortenedCourseClassTransferReceiptSchema.safeParse(prior.response);
      if (!storedRequest.success || !storedReceipt.success || storedReceipt.data.replayed || prior.raceId !== race.id ||
          prior.actorCredentialId !== auth.principal.accessCredentialId || !canonicalEquals(storedRequest.data, intent) ||
          storedReceipt.data.transferId !== prior.requestId || storedReceipt.data.sourceBasisHash !== prior.sourceHash ||
          storedReceipt.data.sourceSnapshotVersion !== prior.sourceSnapshotVersion || storedReceipt.data.shortCourseId !== prior.shortCourseId ||
          storedReceipt.data.shortCourseVersionId !== prior.shortCourseVersionId || storedReceipt.data.shortClassId !== prior.shortClassId ||
          !canonicalEquals(storedReceipt.data.request, storedRequest.data)) return { status: "conflict" };
      return { status: "transferred", response: { ...storedReceipt.data, replayed: true } };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= maxVersion) return { status: "conflict" };
    const basis = await buildBasis(tx, race.id, intent.sourceClassId);
    if (basis.status !== "ok") return basis;
    const candidate = basis.value.candidate;
    if (candidate.sourceCourseVersionId !== intent.expectedSourceCourseVersionId || candidate.sourceStartRule !== intent.expectedSourceStartRule ||
        candidate.snapshotVersion !== intent.expectedSnapshotVersion || candidate.basisHash !== intent.expectedBasisHash ||
        candidate.sourceControls.length !== intent.expectedSourceControlCount ||
        !canonicalEquals(candidate.sourceControls.slice(0, intent.controlPrefix.length), intent.controlPrefix)) return { status: "conflict" };
    const candidateByEntry = new Map(candidate.entries.map((entry) => [entry.entryId, entry]));
    const selected = intent.entryIds.map((entryId) => candidateByEntry.get(entryId));
    if (selected.some((entry) => entry === undefined)) return { status: "conflict" };
    const [sameCourseName, sameClassName] = await Promise.all([
      tx.select({ id: schema.courses.id }).from(schema.courses).where(and(eq(schema.courses.raceId, race.id), eq(schema.courses.name, intent.shortCourseName))).limit(1),
      tx.select({ id: schema.classes.id }).from(schema.classes).where(and(eq(schema.classes.raceId, race.id), eq(schema.classes.name, intent.shortClassName))).limit(1)
    ]);
    if (sameCourseName.length > 0 || sameClassName.length > 0) return { status: "conflict" };
    for (const selectedEntry of selected) {
      const entry = selectedEntry!;
      const [locked] = await tx.select({ row: schema.entries,
        exactTime: sql<boolean>`${schema.entries.fixedStartTime} IS NULL OR date_trunc('milliseconds', ${schema.entries.fixedStartTime}) = ${schema.entries.fixedStartTime}`
      }).from(schema.entries).where(and(eq(schema.entries.id, entry.entryId), eq(schema.entries.raceId, race.id))).for("update");
      if (!locked || !locked.exactTime || locked.row.classId !== intent.sourceClassId || locked.row.version !== entry.entryVersion ||
          (locked.row.fixedStartTime?.toISOString() ?? null) !== entry.fixedStartTime ||
          (candidate.sourceStartRule === "FIXED") !== (locked.row.fixedStartTime !== null)) return { status: "conflict" };
      const [latest] = await tx.select().from(schema.resultRevisions).where(and(
        eq(schema.resultRevisions.raceId, race.id), eq(schema.resultRevisions.entryId, entry.entryId)
      )).orderBy(desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id)).limit(1).for("update");
      if (entry.sourceResult.kind === "NO_RESULT") {
        if (latest) return { status: "conflict" };
      } else if (!latest || latest.id !== entry.sourceResult.resultRevisionId || latest.revision !== entry.sourceResult.resultRevision ||
          latest.readoutId !== entry.sourceResult.readoutId || latest.snapshotVersion !== entry.sourceResult.snapshotVersion ||
          latest.courseVersionId !== entry.sourceResult.courseVersionId || latest.cause !== entry.sourceResult.cause ||
          latest.status !== entry.sourceResult.status || latest.published !== entry.sourceResult.published) return { status: "conflict" };
    }
    const shortCourseId = randomUUID(), shortCourseVersionId = randomUUID(), shortClassId = randomUUID();
    await tx.insert(schema.courses).values({ id: shortCourseId, raceId: race.id, name: intent.shortCourseName });
    await tx.insert(schema.courseVersions).values({ id: shortCourseVersionId, courseId: shortCourseId, version: 1 });
    for (const control of intent.controlPrefix) {
      await tx.insert(schema.controls).values({ raceId: race.id, code: control.controlCode }).onConflictDoNothing();
      const [stored] = await tx.select({ id: schema.controls.id }).from(schema.controls)
        .where(and(eq(schema.controls.raceId, race.id), eq(schema.controls.code, control.controlCode)));
      if (!stored) throw new Error("Kortbanans kontroll kunde inte sparas");
      await tx.insert(schema.courseControls).values({ courseVersionId: shortCourseVersionId, controlId: stored.id, sequence: control.sequence });
    }
    await tx.insert(schema.classes).values({ id: shortClassId, raceId: race.id, name: intent.shortClassName,
      courseVersionId: shortCourseVersionId, startRule: candidate.sourceStartRule });
    for (const selectedEntry of selected) {
      const entry = selectedEntry!;
      await tx.update(schema.entries).set({ classId: shortClassId, version: entry.entryVersion + 1 })
        .where(and(eq(schema.entries.id, entry.entryId), eq(schema.entries.raceId, race.id), eq(schema.entries.version, entry.entryVersion)));
    }
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, race.id));
    const snapshot = await loadRaceSnapshot(tx, race.id);
    const reEvaluations = new Map<string, { id: string; revision: number; status: "OK" | "MP"; evaluation: Exclude<ReturnType<typeof evaluateCardReadout>, { status: "UNKNOWN_CARD" }> }>();
    for (const selectedEntry of selected) {
      const entry = selectedEntry!;
      if (entry.sourceResult.kind === "NO_RESULT") continue;
      const [readout] = await tx.select().from(schema.cardReadouts).where(and(
        eq(schema.cardReadouts.id, entry.sourceResult.readoutId), eq(schema.cardReadouts.raceId, race.id)
      ));
      if (!readout) throw new Error("Kortbaneöverflyttningens avläsning saknas");
      const normalized: NormalizedCardReadout = { id: readout.id, raceId: race.id, cardNumber: readout.cardNumber,
        ...(readout.startPunchedAt ? { startPunchedAt: readout.startPunchedAt.toISOString() } : {}),
        ...(readout.finishPunchedAt ? { finishPunchedAt: readout.finishPunchedAt.toISOString() } : {}), punches: readout.punches,
        rawMessageId: readout.rawMessageId, readAt: readout.readAt.toISOString() };
      const evaluation = evaluateCardReadout(normalized, snapshot);
      if (evaluation.status === "UNKNOWN_CARD" || evaluation.entryId !== entry.entryId || evaluation.classId !== shortClassId ||
          evaluation.courseVersionId !== shortCourseVersionId || (evaluation.status !== "OK" && evaluation.status !== "MP")) {
        throw new Error("Kortbaneöverflyttningens avläsning kunde inte utvärderas");
      }
      reEvaluations.set(entry.entryId, { id: randomUUID(), revision: entry.sourceResult.resultRevision + 1,
        status: evaluation.status, evaluation });
    }
    const receipt = shortenedCourseClassTransferReceiptSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId,
      transferId: intent.requestId, raceId: race.id, sourceClassId: candidate.sourceClassId,
      sourceCourseVersionId: candidate.sourceCourseVersionId, shortCourseId, shortCourseVersionId, shortClassId,
      sourceSnapshotVersion: race.snapshotVersion, snapshotVersionAfter, sourceBasisHash: candidate.basisHash,
      request: intent, transferredAt: now.toISOString(), items: selected.map((entry) => {
        const value = entry!, reEvaluation = reEvaluations.get(value.entryId);
        return reEvaluation ? { entryId: value.entryId, entryVersionBefore: value.entryVersion, entryVersionAfter: value.entryVersion + 1,
          effect: "MOVED_AND_REEVALUATED" as const, sourceResultRevisionId: value.sourceResult.kind === "CARD_READOUT_MP" ? value.sourceResult.resultRevisionId : null,
          sourceReadoutId: value.sourceResult.kind === "CARD_READOUT_MP" ? value.sourceResult.readoutId : null,
          createdResultRevisionId: reEvaluation.id, createdResultRevision: reEvaluation.revision, resultingStatus: reEvaluation.status }
          : { entryId: value.entryId, entryVersionBefore: value.entryVersion, entryVersionAfter: value.entryVersion + 1,
            effect: "MOVED_ONLY" as const, sourceResultRevisionId: null, sourceReadoutId: null,
            createdResultRevisionId: null, createdResultRevision: null, resultingStatus: null };
      }) });
    await tx.insert(schema.shortenedCourseClassTransfers).values({ requestId: intent.requestId, raceId: race.id,
      sourceClassId: candidate.sourceClassId, sourceCourseId: candidate.sourceCourseId, sourceCourseVersionId: candidate.sourceCourseVersionId,
      shortCourseId, shortCourseVersionId, shortClassId, actorCredentialId: auth.principal.accessCredentialId,
      capability: "MANAGE_RACE", sourceSnapshotVersion: race.snapshotVersion, sourceHash: candidate.basisHash,
      frozenBasis: basis.value.frozenBasis, request: intent, response: receipt, transferredAt: now });
    const resultRows = selected.flatMap((entry) => {
      const value = entry!, reEvaluation = reEvaluations.get(value.entryId);
      if (!reEvaluation || value.sourceResult.kind !== "CARD_READOUT_MP") return [];
      return [{ id: reEvaluation.id, raceId: race.id, entryId: value.entryId, readoutId: value.sourceResult.readoutId,
        revision: reEvaluation.revision, cause: "SHORTENED_COURSE_CLASS_TRANSFER" as const, status: reEvaluation.evaluation.status,
        reason: reEvaluation.evaluation.reason, evaluation: reEvaluation.evaluation, engineVersion: RESULT_ENGINE_VERSION,
        snapshotVersion: snapshotVersionAfter, courseVersionId: shortCourseVersionId, published: true,
        shortenedCourseClassTransferId: intent.requestId, createdAt: now }];
    });
    if (resultRows.length > 0) await tx.insert(schema.resultRevisions).values(resultRows);
    await tx.insert(schema.shortenedCourseClassTransferItems).values(selected.map((entry) => {
      const value = entry!, reEvaluation = reEvaluations.get(value.entryId);
      return { requestId: intent.requestId, raceId: race.id, entryId: value.entryId, entryVersionBefore: value.entryVersion,
        entryVersionAfter: value.entryVersion + 1, sourceResultRevisionId: value.sourceResult.kind === "CARD_READOUT_MP" ? value.sourceResult.resultRevisionId : null,
        sourceResultRevision: value.sourceResult.kind === "CARD_READOUT_MP" ? value.sourceResult.resultRevision : null,
        sourceReadoutId: value.sourceResult.kind === "CARD_READOUT_MP" ? value.sourceResult.readoutId : null,
        createdResultRevisionId: reEvaluation?.id ?? null, createdResultRevision: reEvaluation?.revision ?? null };
    }));
    await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "class", entityId: shortClassId,
      action: "SHORTENED_COURSE_CLASS_TRANSFERRED_BY_ADMIN", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      requestId: intent.requestId, before: { sourceClassId: candidate.sourceClassId, sourceCourseVersionId: candidate.sourceCourseVersionId,
        snapshotVersion: race.snapshotVersion, sourceBasisHash: candidate.basisHash }, after: { shortCourseId, shortCourseVersionId, shortClassId,
        transferredEntries: intent.entryIds, reEvaluatedEntries: receipt.items.filter((item) => item.effect === "MOVED_AND_REEVALUATED").map((item) => item.entryId),
        snapshotVersion: snapshotVersionAfter }, createdAt: now });
    return { status: "transferred", response: receipt };
  });
}

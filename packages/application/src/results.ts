import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import {
  entryClassAdminListResponseSchema,
  entryClassChangeIdempotencyKeySchema,
  entryClassChangeRequestSchema,
  entryClassChangeResponseSchema,
  publicResultDetailResponseSchema,
  publicResultIdSchema,
  publicResultListResponseSchema,
  resultRecalculationCandidateResponseSchema,
  resultRecalculationIdempotencyKeySchema,
  resultRecalculationRequestSchema,
  resultRecalculationResponseSchema,
  type EntryClassAdminListResponse,
  type EntryClassChangeResponse,
  type PublicResultDetailResponse,
  type PublicResultListResponse,
  type PublicResultV7,
  type ResultRecalculationCandidateResponse,
  type ResultRecalculationResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import {
  compareResultStatuses,
  evaluateCardReadout,
  rankClassResults,
  RESULT_ENGINE_VERSION,
  type NormalizedCardReadout
} from "@o-tid/domain";
import { loadCourseVersionVariants, variantAfterClassChange } from "./course-variants";
import { loadRaceSnapshot } from "./snapshot";
import { lockEntryForRevision, lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { parseStrictStoredResultRevision } from "./stored-result-revision";
import { canAddClassEntry, ClassCapacityConflictError } from "./class-capacity-guard";
import { appliedControlNeutralization } from "./class-control-neutralization";
import { isResultCurrent, loadResultBasisHashes } from "./result-basis";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The public list and public route overlays must resolve exactly the same
 * published heads. Keep this selection in one place: manual overlays can make
 * the effective head differ from the latest stored result revision.
 */
async function selectPublishedPublicResultHeads(tx: DatabaseTransaction, raceId: string) {
  const rows = await tx.selectDistinctOn([schema.resultRevisions.entryId], {
    id: schema.resultRevisions.id,
    raceId: schema.resultRevisions.raceId,
    entryId: schema.resultRevisions.entryId,
    publicResultId: schema.entries.publicResultId,
    revision: schema.resultRevisions.revision,
    status: schema.resultRevisions.status,
    reason: schema.resultRevisions.reason,
    cause: schema.resultRevisions.cause,
    readoutId: schema.resultRevisions.readoutId,
    didNotStartDecisionId: schema.resultRevisions.didNotStartDecisionId,
    startCheckinDnsDecisionId: schema.resultRevisions.startCheckinDnsDecisionId,
    controlNeutralizationId: schema.resultRevisions.controlNeutralizationId,
    disqualificationDecisionId: schema.resultRevisions.disqualificationDecisionId,
    disqualificationWithdrawalId: schema.resultRevisions.disqualificationWithdrawalId,
    approvalDecisionId: schema.resultRevisions.approvalDecisionId,
    approvalWithdrawalId: schema.resultRevisions.approvalWithdrawalId,
    didNotFinishDecisionId: schema.resultRevisions.didNotFinishDecisionId,
    didNotFinishWithdrawalId: schema.resultRevisions.didNotFinishWithdrawalId,
    notCompetingDecisionId: schema.resultRevisions.notCompetingDecisionId,
    notCompetingWithdrawalId: schema.resultRevisions.notCompetingWithdrawalId,
    withoutTimingDecisionId: schema.resultRevisions.withoutTimingDecisionId,
    withoutTimingWithdrawalId: schema.resultRevisions.withoutTimingWithdrawalId,
    manualFinishTimeCorrectionId: schema.resultRevisions.manualFinishTimeCorrectionId,
    manualFinishTimeCorrectionWithdrawalId: schema.resultRevisions.manualFinishTimeCorrectionWithdrawalId,
    manualPunchStartTimeCorrectionId: schema.resultRevisions.manualPunchStartTimeCorrectionId,
    manualPunchStartTimeCorrectionWithdrawalId: schema.resultRevisions.manualPunchStartTimeCorrectionWithdrawalId,
    shortenedCourseClassTransferId: schema.resultRevisions.shortenedCourseClassTransferId,
    evaluation: schema.resultRevisions.evaluation,
    engineVersion: schema.resultRevisions.engineVersion,
    snapshotVersion: schema.resultRevisions.snapshotVersion,
    courseVersionId: schema.resultRevisions.courseVersionId,
    published: schema.resultRevisions.published,
    createdAt: schema.resultRevisions.createdAt,
    givenName: schema.entries.givenName,
    familyName: schema.entries.familyName,
    organisationName: schema.entries.organisationName,
    teamId: schema.entries.teamId
  }).from(schema.resultRevisions)
    .innerJoin(schema.entries, and(
      eq(schema.resultRevisions.entryId, schema.entries.id),
      eq(schema.entries.raceId, raceId)
    ))
    .where(and(
      eq(schema.resultRevisions.raceId, raceId),
      eq(schema.resultRevisions.published, true)
    ))
    .orderBy(
      asc(schema.resultRevisions.entryId),
      desc(schema.resultRevisions.revision),
      desc(schema.resultRevisions.id)
    )
    .limit(10_001);
  if (rows.length > 10_000) throw new Error("Publikresultatet är för stort");
  return rows;
}

export async function changeEntryClass(db: Database, raceId: string, entryId: string, classId: string) {
  return db.transaction(async (tx) => {
    await lockRaceForMutation(tx, raceId);
    const entry = await lockEntryForRevision(tx, raceId, entryId);
    const [raceClass] = await tx.select().from(schema.classes).where(and(
      eq(schema.classes.id, classId), eq(schema.classes.raceId, raceId)
    ));
    if (!raceClass) throw new Error("Klassen finns inte i loppet");
    if (entry.classId !== classId && (entry.teamId !== null || !await canAddClassEntry(tx, raceId, classId))) {
      throw new ClassCapacityConflictError("Klassens deltagargräns är nådd");
    }
    const [updated] = await tx.update(schema.entries).set({ classId, version: entry.version + 1 })
      .where(and(eq(schema.entries.id, entryId), eq(schema.entries.version, entry.version))).returning();
    if (!updated) throw new Error("Deltagaren ändrades samtidigt av en annan operatör");
    await tx.insert(schema.auditEvents).values({
      raceId,
      entityType: "entry",
      entityId: entryId,
      action: "CLASS_CHANGED",
      before: { classId: entry.classId, version: entry.version },
      after: { classId, version: updated.version }
    });
    await tx.update(schema.races).set({ snapshotVersion: sql`${schema.races.snapshotVersion} + 1` })
      .where(eq(schema.races.id, raceId));
    return updated;
  });
}

export type EntryClassAdminListResult =
  | { status: "unauthorized" | "forbidden" }
  | { status: "ok"; response: EntryClassAdminListResponse };

export async function listEntryClassesAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability">,
  now = new Date()
): Promise<EntryClassAdminListResult> {
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      ...input,
      capability: "CHANGE_ENTRY_CLASS"
    }, now);
    if (authorization.status !== "authenticated") return authorization;
    const race = await lockRaceForSnapshot(tx, authorization.principal.raceId);
    const classes = await tx.select({ id: schema.classes.id, name: schema.classes.name })
      .from(schema.classes)
      .where(eq(schema.classes.raceId, authorization.principal.raceId))
      .orderBy(asc(schema.classes.name), asc(schema.classes.id));
    const entries = await tx.select({
      id: schema.entries.id,
      givenName: schema.entries.givenName,
      familyName: schema.entries.familyName,
      organisationName: schema.entries.organisationName,
      classId: schema.entries.classId,
      version: schema.entries.version
    }).from(schema.entries)
      .where(eq(schema.entries.raceId, authorization.principal.raceId))
      .orderBy(asc(schema.entries.familyName), asc(schema.entries.givenName), asc(schema.entries.id));
    const response = entryClassAdminListResponseSchema.parse({
      formatVersion: 1,
      raceId: authorization.principal.raceId,
      snapshotVersion: race.snapshotVersion,
      classes,
      entries: entries.map(({ givenName, familyName, ...entry }) => ({
        ...entry,
        displayName: `${givenName} ${familyName}`
      }))
    });
    return { status: "ok", response };
  });
}

export type AuthenticatedEntryClassChangeResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" }
  | { status: "changed"; response: EntryClassChangeResponse };

export type AuthenticatedEntryClassChangeInput = Omit<PairingAdminRequestAuthentication, "capability"> & {
  entryId: string;
  idempotencyKey: string | null;
  request: unknown;
};

function entryClassChangeResponse(
  row: typeof schema.entryClassChangeRequests.$inferSelect,
  replayed: boolean
): EntryClassChangeResponse {
  return entryClassChangeResponseSchema.parse({
    formatVersion: 1,
    replayed,
    requestId: row.requestId,
    raceId: row.raceId,
    entryId: row.entryId,
    previousClassId: row.previousClassId,
    classId: row.classId,
    entryVersionBefore: row.entryVersionBefore,
    entryVersionAfter: row.entryVersionAfter,
    snapshotVersionBefore: row.snapshotVersionBefore,
    snapshotVersionAfter: row.snapshotVersionAfter,
    changedAt: row.changedAt.toISOString()
  });
}

export async function changeEntryClassAsAdmin(
  db: Database,
  input: AuthenticatedEntryClassChangeInput,
  now = new Date()
): Promise<AuthenticatedEntryClassChangeResult> {
  const idempotencyKey = entryClassChangeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = entryClassChangeRequestSchema.safeParse(input.request);
  if (!idempotencyKey.success || !request.success || !UUID_PATTERN.test(input.entryId)) {
    return { status: "invalid-request" };
  }
  const requestId = idempotencyKey.data.slice("entry-class-change:".length);
  const changedAt = new Date(now);
  if (!Number.isFinite(changedAt.getTime())) throw new Error("Ändringstiden är ogiltig");

  const preflightAuthorization = await authenticatePairingAdminSession(db, {
    sessionToken: input.sessionToken,
    raceId: input.raceId,
    capability: "CHANGE_ENTRY_CLASS",
    csrfCookie: input.csrfCookie ?? null,
    csrfHeader: input.csrfHeader ?? null,
    requireCsrf: true
  }, changedAt);
  if (preflightAuthorization.status !== "authenticated") return preflightAuthorization;

  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForMutation(tx, {
      sessionToken: input.sessionToken,
      raceId: input.raceId,
      capability: "CHANGE_ENTRY_CLASS",
      csrfCookie: input.csrfCookie ?? null,
      csrfHeader: input.csrfHeader ?? null,
      requireCsrf: true
    }, changedAt);
    if (authorization.status !== "authenticated") return authorization;

    const race = await lockRaceForMutation(tx, authorization.principal.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existingRequest] = await tx.select().from(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.requestId, requestId));
    if (existingRequest) {
      const exact = existingRequest.actorCredentialId === authorization.principal.accessCredentialId &&
        existingRequest.raceId === authorization.principal.raceId &&
        existingRequest.entryId === input.entryId &&
        existingRequest.classId === request.data.classId &&
        existingRequest.expectedEntryVersion === request.data.expectedEntryVersion;
      if (!exact) return { status: "conflict" };
      return { status: "changed", response: entryClassChangeResponse(existingRequest, true) };
    }

    const [entry] = await tx.select().from(schema.entries).where(and(
      eq(schema.entries.id, input.entryId),
      eq(schema.entries.raceId, authorization.principal.raceId)
    )).for("update");
    if (!entry) return { status: "not-found" };
    const [targetClass] = await tx.select({ id: schema.classes.id }).from(schema.classes).where(and(
      eq(schema.classes.id, request.data.classId),
      eq(schema.classes.raceId, authorization.principal.raceId)
    ));
    if (!targetClass) return { status: "not-found" };
    // En sträcklöpare byter inte klass; laget hör till stafettklassen.
    if (entry.version !== request.data.expectedEntryVersion || entry.classId === request.data.classId || entry.teamId !== null) {
      return { status: "conflict" };
    }
    if (!await canAddClassEntry(tx, authorization.principal.raceId, request.data.classId)) return { status: "conflict" };

    const entryVersionAfter = entry.version + 1;
    const snapshotVersionAfter = race.snapshotVersion + 1;
    const [updated] = await tx.update(schema.entries).set({
      classId: request.data.classId,
      courseVariantCode: await variantAfterClassChange(tx, authorization.principal.raceId, entry.id, request.data.classId,
        entry.courseVariantCode),
      version: entryVersionAfter
    }).where(and(
      eq(schema.entries.id, entry.id),
      eq(schema.entries.raceId, authorization.principal.raceId),
      eq(schema.entries.version, entry.version)
    )).returning({ id: schema.entries.id });
    if (!updated) return { status: "conflict" };
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter })
      .where(eq(schema.races.id, authorization.principal.raceId));
    const [savedRequest] = await tx.insert(schema.entryClassChangeRequests).values({
      requestId,
      raceId: authorization.principal.raceId,
      actorCredentialId: authorization.principal.accessCredentialId,
      entryId: entry.id,
      expectedEntryVersion: request.data.expectedEntryVersion,
      previousClassId: entry.classId,
      classId: request.data.classId,
      entryVersionBefore: entry.version,
      entryVersionAfter,
      snapshotVersionBefore: race.snapshotVersion,
      snapshotVersionAfter,
      changedAt
    }).returning();
    if (!savedRequest) throw new Error("Klassändringsrequesten kunde inte sparas");
    await tx.insert(schema.auditEvents).values({
      raceId: authorization.principal.raceId,
      entityType: "entry",
      entityId: entry.id,
      action: "ENTRY_CLASS_CHANGED_BY_ADMIN",
      actorKind: authorization.principal.capability === "MANAGE_RACE"
        ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "ENTRY_CLASS_ACCESS_CREDENTIAL",
      actorId: authorization.principal.accessCredentialId,
      requestId,
      before: {
        classId: entry.classId,
        entryVersion: entry.version,
        snapshotVersion: race.snapshotVersion
      },
      after: {
        classId: request.data.classId,
        entryVersion: entryVersionAfter,
        snapshotVersion: snapshotVersionAfter
      }
    });
    return { status: "changed", response: entryClassChangeResponse(savedRequest, false) };
  });
}

export type ResultRecalculationCandidateListResult =
  | { status: "unauthorized" | "forbidden" }
  | { status: "ok"; response: ResultRecalculationCandidateResponse };

export async function listResultRecalculationCandidatesAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability">,
  now = new Date()
): Promise<ResultRecalculationCandidateListResult> {
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      ...input,
      capability: "RECALCULATE_RESULT"
    }, now);
    if (authorization.status !== "authenticated") return authorization;
    const race = await lockRaceForSnapshot(tx, authorization.principal.raceId);
    const entries = await tx.select({
      id: schema.entries.id,
      givenName: schema.entries.givenName,
      familyName: schema.entries.familyName,
      organisationName: schema.entries.organisationName,
      classId: schema.entries.classId,
      className: schema.classes.name,
      entryVersion: schema.entries.version
    }).from(schema.entries)
      .innerJoin(schema.classes, eq(schema.entries.classId, schema.classes.id))
      .where(eq(schema.entries.raceId, authorization.principal.raceId))
      .orderBy(asc(schema.entries.familyName), asc(schema.entries.givenName), asc(schema.entries.id));
    const activeAssignments = await tx.select({
      id: schema.cardAssignments.id,
      entryId: schema.cardAssignments.entryId,
      cardNumber: schema.cardAssignments.cardNumber
    }).from(schema.cardAssignments).where(and(
      eq(schema.cardAssignments.raceId, authorization.principal.raceId),
      eq(schema.cardAssignments.active, true)
    )).orderBy(asc(schema.cardAssignments.entryId), asc(schema.cardAssignments.id));
    const cardNumbers = [...new Set(activeAssignments.map((assignment) => assignment.cardNumber))];
    const latestReadouts = cardNumbers.length === 0 ? [] : await tx.selectDistinctOn(
      [schema.cardReadouts.cardNumber],
      {
        id: schema.cardReadouts.id,
        cardNumber: schema.cardReadouts.cardNumber,
        readAt: schema.cardReadouts.readAt
      }
    ).from(schema.cardReadouts).where(and(
      eq(schema.cardReadouts.raceId, authorization.principal.raceId),
      inArray(schema.cardReadouts.cardNumber, cardNumbers)
    )).orderBy(
      asc(schema.cardReadouts.cardNumber),
      desc(schema.cardReadouts.readAt),
      desc(schema.cardReadouts.id)
    );
    const latestRevisions = await tx.selectDistinctOn(
      [schema.resultRevisions.entryId],
      {
        id: schema.resultRevisions.id,
        entryId: schema.resultRevisions.entryId,
        revision: schema.resultRevisions.revision,
        status: schema.resultRevisions.status,
        reason: schema.resultRevisions.reason,
        cause: schema.resultRevisions.cause,
        createdAt: schema.resultRevisions.createdAt,
        snapshotVersion: schema.resultRevisions.snapshotVersion,
        basisHash: schema.resultRevisions.basisHash
      }
    ).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, authorization.principal.raceId))
      .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision));

    const assignmentsByEntry = new Map<string, typeof activeAssignments>();
    for (const assignment of activeAssignments) {
      const assignments = assignmentsByEntry.get(assignment.entryId) ?? [];
      assignments.push(assignment);
      assignmentsByEntry.set(assignment.entryId, assignments);
    }
    const readoutByCard = new Map(latestReadouts.map((readout) => [readout.cardNumber, readout]));
    const revisionByEntry = new Map(latestRevisions.map((revision) => [revision.entryId, revision]));
    const basisHashes = await loadResultBasisHashes(tx, authorization.principal.raceId);

    const response = resultRecalculationCandidateResponseSchema.parse({
      formatVersion: 1,
      raceId: authorization.principal.raceId,
      snapshotVersion: race.snapshotVersion,
      engineVersion: RESULT_ENGINE_VERSION,
      entries: entries.map(({ givenName, familyName, ...entry }) => {
        const assignments = assignmentsByEntry.get(entry.id) ?? [];
        const assignment = assignments.length === 1 ? assignments[0] : undefined;
        const readout = assignment ? readoutByCard.get(assignment.cardNumber) : undefined;
        const readiness = assignments.length === 0 ? "NO_ACTIVE_ASSIGNMENT" :
          assignments.length > 1 ? "MULTIPLE_ACTIVE_ASSIGNMENTS" :
            readout ? "READY" : "NO_READOUT";
        const latestRevision = revisionByEntry.get(entry.id);
        return {
          ...entry,
          displayName: `${givenName} ${familyName}`,
          readiness,
          cardAssignmentId: assignment?.id ?? null,
          latestReadout: readout ? { id: readout.id, readAt: readout.readAt.toISOString() } : null,
          latestResultRevision: latestRevision ? {
            id: latestRevision.id,
            revision: latestRevision.revision,
            status: latestRevision.status,
            reason: latestRevision.reason,
            cause: latestRevision.cause,
            createdAt: latestRevision.createdAt.toISOString(),
            snapshotVersion: latestRevision.snapshotVersion,
            current: isResultCurrent(latestRevision, basisHashes.get(entry.id), race.snapshotVersion)
          } : null
        };
      })
    });
    return { status: "ok", response };
  });
}

export type AuthenticatedResultRecalculationResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" }
  | { status: "recalculated"; response: ResultRecalculationResponse };

export type AuthenticatedResultRecalculationInput = Omit<PairingAdminRequestAuthentication, "capability"> & {
  entryId: string;
  idempotencyKey: string | null;
  request: unknown;
};

function resultRecalculationResponse(
  request: typeof schema.resultRecalculationRequests.$inferSelect,
  result: typeof schema.resultRevisions.$inferSelect,
  replayed: boolean
): ResultRecalculationResponse {
  return resultRecalculationResponseSchema.parse({
    formatVersion: 1,
    replayed,
    requestId: request.requestId,
    raceId: request.raceId,
    entryId: request.entryId,
    readoutId: result.readoutId,
    resultRevisionId: result.id,
    revision: result.revision,
    cause: result.cause,
    status: result.status,
    reason: result.reason,
    engineVersion: result.engineVersion,
    snapshotVersion: result.snapshotVersion,
    courseVersionId: result.courseVersionId,
    recalculatedAt: request.recalculatedAt.toISOString()
  });
}

export async function recalculateEntryAsAdmin(
  db: Database,
  input: AuthenticatedResultRecalculationInput,
  now = new Date()
): Promise<AuthenticatedResultRecalculationResult> {
  const idempotencyKey = resultRecalculationIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = resultRecalculationRequestSchema.safeParse(input.request);
  if (!idempotencyKey.success || !request.success || !UUID_PATTERN.test(input.entryId)) {
    return { status: "invalid-request" };
  }
  const requestId = idempotencyKey.data.slice("result-recalculation:".length);
  const recalculatedAt = new Date(now);
  if (!Number.isFinite(recalculatedAt.getTime())) throw new Error("Omräkningstiden är ogiltig");

  const preflightAuthorization = await authenticatePairingAdminSession(db, {
    sessionToken: input.sessionToken,
    raceId: input.raceId,
    capability: "RECALCULATE_RESULT",
    csrfCookie: input.csrfCookie ?? null,
    csrfHeader: input.csrfHeader ?? null,
    requireCsrf: true
  }, recalculatedAt);
  if (preflightAuthorization.status !== "authenticated") return preflightAuthorization;

  const expectedLatestResultRevisionId = request.data.expectedLatestResultRevision?.id ?? null;
  const expectedLatestResultRevision = request.data.expectedLatestResultRevision?.revision ?? 0;
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForMutation(tx, {
      sessionToken: input.sessionToken,
      raceId: input.raceId,
      capability: "RECALCULATE_RESULT",
      csrfCookie: input.csrfCookie ?? null,
      csrfHeader: input.csrfHeader ?? null,
      requireCsrf: true
    }, recalculatedAt);
    if (authorization.status !== "authenticated") return authorization;

    const race = await lockRaceForSnapshot(tx, authorization.principal.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existingRequest] = await tx.select().from(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.requestId, requestId));
    if (existingRequest) {
      const exact = existingRequest.actorCredentialId === authorization.principal.accessCredentialId &&
        existingRequest.raceId === authorization.principal.raceId &&
        existingRequest.entryId === input.entryId &&
        existingRequest.expectedEntryVersion === request.data.expectedEntryVersion &&
        existingRequest.expectedClassId === request.data.expectedClassId &&
        existingRequest.expectedSnapshotVersion === request.data.expectedSnapshotVersion &&
        existingRequest.expectedCardAssignmentId === request.data.expectedCardAssignmentId &&
        existingRequest.expectedReadoutId === request.data.expectedReadoutId &&
        existingRequest.expectedLatestResultRevisionId === expectedLatestResultRevisionId &&
        existingRequest.expectedLatestResultRevision === expectedLatestResultRevision &&
        existingRequest.expectedEngineVersion === request.data.expectedEngineVersion;
      if (!exact) return { status: "conflict" };
      const [existingResult] = await tx.select().from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.id, existingRequest.createdResultRevisionId));
      if (!existingResult) throw new Error("Omräkningsrequestens resultatrevision saknas");
      return { status: "recalculated", response: resultRecalculationResponse(existingRequest, existingResult, true) };
    }

    const [entry] = await tx.select().from(schema.entries).where(and(
      eq(schema.entries.id, input.entryId),
      eq(schema.entries.raceId, authorization.principal.raceId)
    )).for("update");
    if (!entry) return { status: "not-found" };
    if (entry.version !== request.data.expectedEntryVersion ||
      entry.classId !== request.data.expectedClassId ||
      race.snapshotVersion !== request.data.expectedSnapshotVersion ||
      request.data.expectedEngineVersion !== RESULT_ENGINE_VERSION) {
      return { status: "conflict" };
    }

    const assignments = await tx.select().from(schema.cardAssignments).where(and(
      eq(schema.cardAssignments.raceId, authorization.principal.raceId),
      eq(schema.cardAssignments.entryId, entry.id),
      eq(schema.cardAssignments.active, true)
    )).orderBy(asc(schema.cardAssignments.id)).limit(2);
    const assignment = assignments.length === 1 ? assignments[0] : undefined;
    if (!assignment || assignment.id !== request.data.expectedCardAssignmentId) return { status: "conflict" };

    const [readout] = await tx.select().from(schema.cardReadouts).where(and(
      eq(schema.cardReadouts.raceId, authorization.principal.raceId),
      eq(schema.cardReadouts.cardNumber, assignment.cardNumber)
    )).orderBy(desc(schema.cardReadouts.readAt), desc(schema.cardReadouts.id)).limit(1);
    if (!readout || readout.id !== request.data.expectedReadoutId) return { status: "conflict" };

    const [latestResult] = await tx.select().from(schema.resultRevisions).where(and(
      eq(schema.resultRevisions.raceId, authorization.principal.raceId),
      eq(schema.resultRevisions.entryId, entry.id)
    )).orderBy(desc(schema.resultRevisions.revision)).limit(1);
    const latestMatches = request.data.expectedLatestResultRevision === null
      ? latestResult === undefined
      : latestResult?.id === request.data.expectedLatestResultRevision.id &&
        latestResult.revision === request.data.expectedLatestResultRevision.revision;
    if (!latestMatches) return { status: "conflict" };

    const normalized: NormalizedCardReadout = {
      id: readout.id,
      raceId: authorization.principal.raceId,
      cardNumber: readout.cardNumber,
      ...(readout.startPunchedAt ? { startPunchedAt: readout.startPunchedAt.toISOString() } : {}),
      ...(readout.finishPunchedAt ? { finishPunchedAt: readout.finishPunchedAt.toISOString() } : {}),
      punches: readout.punches,
      rawMessageId: readout.rawMessageId,
      readAt: readout.readAt.toISOString()
    };
    const snapshot = await loadRaceSnapshot(tx, authorization.principal.raceId);
    const evaluation = evaluateCardReadout(normalized, snapshot);
    if (evaluation.entryId !== entry.id || !evaluation.courseVersionId) return { status: "conflict" };
    const controlNeutralizationId = appliedControlNeutralization(snapshot, evaluation);

    const revision = (latestResult?.revision ?? 0) + 1;
    const [createdResult] = await tx.insert(schema.resultRevisions).values({
      raceId: authorization.principal.raceId,
      entryId: entry.id,
      readoutId: readout.id,
      revision,
      cause: "EXPLICIT_RECALCULATION",
      status: evaluation.status,
      reason: evaluation.reason,
      evaluation,
      engineVersion: RESULT_ENGINE_VERSION,
      snapshotVersion: snapshot.race.snapshotVersion,
      courseVersionId: evaluation.courseVersionId,
      controlNeutralizationId,
      published: true
    }).returning();
    if (!createdResult) throw new Error("Resultatrevisionen kunde inte sparas");
    const [savedRequest] = await tx.insert(schema.resultRecalculationRequests).values({
      requestId,
      raceId: authorization.principal.raceId,
      actorCredentialId: authorization.principal.accessCredentialId,
      entryId: entry.id,
      expectedEntryVersion: request.data.expectedEntryVersion,
      expectedClassId: request.data.expectedClassId,
      expectedSnapshotVersion: request.data.expectedSnapshotVersion,
      expectedCardAssignmentId: request.data.expectedCardAssignmentId,
      expectedReadoutId: request.data.expectedReadoutId,
      expectedLatestResultRevisionId,
      expectedLatestResultRevision,
      expectedEngineVersion: request.data.expectedEngineVersion,
      createdResultRevisionId: createdResult.id,
      createdResultRevision: createdResult.revision,
      recalculatedAt
    }).returning();
    if (!savedRequest) throw new Error("Omräkningsrequesten kunde inte sparas");
    await tx.insert(schema.auditEvents).values({
      raceId: authorization.principal.raceId,
      entityType: "result_revision",
      entityId: createdResult.id,
      action: "RESULT_RECALCULATED_BY_ADMIN",
      actorKind: authorization.principal.capability === "MANAGE_RACE"
        ? "RACE_ADMIN_ACCESS_CREDENTIAL"
        : "RESULT_RECALCULATION_ACCESS_CREDENTIAL",
      actorId: authorization.principal.accessCredentialId,
      requestId,
      after: {
        entryId: entry.id,
        readoutId: readout.id,
        resultRevisionId: createdResult.id,
        revision: createdResult.revision,
        cause: createdResult.cause,
        status: createdResult.status,
        reason: createdResult.reason,
        engineVersion: createdResult.engineVersion,
        snapshotVersion: createdResult.snapshotVersion,
        courseVersionId: createdResult.courseVersionId
      }
    });
    return { status: "recalculated", response: resultRecalculationResponse(savedRequest, createdResult, false) };
  });
}

export async function recalculateEntry(db: Database, raceId: string, entryId: string) {
  return db.transaction(async (tx) => {
    await lockRaceForSnapshot(tx, raceId);
    await lockEntryForRevision(tx, raceId, entryId);
    const [assignment] = await tx.select().from(schema.cardAssignments).where(and(
      eq(schema.cardAssignments.entryId, entryId), eq(schema.cardAssignments.active, true)
    ));
    if (!assignment) throw new Error("Deltagaren saknar aktiv bricka");
    const [readout] = await tx.select().from(schema.cardReadouts).where(and(
      eq(schema.cardReadouts.raceId, raceId), eq(schema.cardReadouts.cardNumber, assignment.cardNumber)
    )).orderBy(desc(schema.cardReadouts.readAt)).limit(1);
    if (!readout) throw new Error("Deltagaren saknar avläsning");
    const normalized: NormalizedCardReadout = {
      id: readout.id,
      raceId,
      cardNumber: readout.cardNumber,
      ...(readout.startPunchedAt ? { startPunchedAt: readout.startPunchedAt.toISOString() } : {}),
      ...(readout.finishPunchedAt ? { finishPunchedAt: readout.finishPunchedAt.toISOString() } : {}),
      punches: readout.punches,
      rawMessageId: readout.rawMessageId,
      readAt: readout.readAt.toISOString()
    };
    const snapshot = await loadRaceSnapshot(tx, raceId);
    const evaluation = evaluateCardReadout(normalized, snapshot);
    if (!evaluation.entryId || !evaluation.courseVersionId) throw new Error("Avläsningen kan inte kopplas till deltagaren");
    const controlNeutralizationId = appliedControlNeutralization(snapshot, evaluation);
    const [latest] = await tx.select({ revision: max(schema.resultRevisions.revision) })
      .from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, entryId));
    const revision = (latest?.revision ?? 0) + 1;
    const [created] = await tx.insert(schema.resultRevisions).values({
      raceId,
      entryId,
      readoutId: readout.id,
      revision,
      cause: "CLASS_CHANGE_RECALCULATION",
      status: evaluation.status,
      reason: evaluation.reason,
      evaluation,
      engineVersion: RESULT_ENGINE_VERSION,
      snapshotVersion: snapshot.race.snapshotVersion,
      courseVersionId: evaluation.courseVersionId,
      controlNeutralizationId,
      published: true
    }).returning();
    await tx.insert(schema.auditEvents).values({
      raceId,
      entityType: "result_revision",
      entityId: created?.id ?? entryId,
      action: "RESULT_RECALCULATED",
      after: { entryId, revision, status: evaluation.status, reason: evaluation.reason }
    });
    return created;
  });
}

export async function publicResults(db: Database, raceId: string): Promise<PublicResultListResponse> {
  return db.transaction(async (tx) => {
    await lockRaceForSnapshot(tx, raceId);
    // Stafettens sträcklöpare visas i lagresultaten och sträckresultaten (publicRelayResults).
    const rows = (await selectPublishedPublicResultHeads(tx, raceId)).filter((row) => row.teamId === null);

    const headStates = await resolveStoredResultHeadStates(tx, raceId, rows);
    const activeStates = headStates.filter((state) =>
      state.state === "ACTIVE_RESULT"
    );

    const parsedRows = activeStates.map((state) => {
      const row = state.head;
      const evaluation = parseStrictStoredResultRevision(row,
        state.startCheckinDns?.source, state.finishTimeCorrection ?? undefined, state.finishTimeCorrectionWithdrawal ?? undefined,
        state.punchStartTimeCorrection ?? undefined, state.punchStartTimeCorrectionWithdrawal ?? undefined,
        state.shortenedCourseClassTransfer ?? undefined);
      return {
        ...row,
        evaluation,
        elapsedMs: "elapsedMs" in evaluation ? evaluation.elapsedMs : undefined
      };
    });
    const classIds = [...new Set(parsedRows.map((row) => row.evaluation.classId))];
    if (classIds.length > 1_000) throw new Error("Publikresultatet innehåller för många klasser");
    const courseVersionIds = [...new Set(parsedRows.map((row) => row.courseVersionId))];
    const [classRows, courseVersionRows] = await Promise.all([
      classIds.length === 0 ? Promise.resolve([]) : tx.select({
        id: schema.classes.id,
        name: schema.classes.name
      }).from(schema.classes).where(and(
        eq(schema.classes.raceId, raceId),
        inArray(schema.classes.id, classIds)
      )),
      courseVersionIds.length === 0 ? Promise.resolve([]) : tx.select({
        id: schema.courseVersions.id,
        raceId: schema.courses.raceId
      }).from(schema.courseVersions)
        .innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id))
        .where(inArray(schema.courseVersions.id, courseVersionIds))
    ]);
    if (classRows.length !== classIds.length) throw new Error("Historisk resultatklass saknas i loppet");
    if (courseVersionRows.length !== courseVersionIds.length ||
        courseVersionRows.some((row) => row.raceId !== raceId)) {
      throw new Error("Historisk banversion saknas i loppet");
    }

    const classNameById = new Map(classRows.map((raceClass) => [raceClass.id, raceClass.name]));
    // Gafflad bana: visa löparens variant när resultatets banversion har den.
    const variantsByVersion = await loadCourseVersionVariants(tx, courseVersionIds);
    const entryVariantRows = variantsByVersion.size === 0 ? [] : await tx.select({ id: schema.entries.id,
      code: schema.entries.courseVariantCode }).from(schema.entries).where(eq(schema.entries.raceId, raceId));
    const entryVariant = new Map(entryVariantRows.map((row) => [row.id, row.code]));
    const variantOf = (entryId: string, courseVersionId: string) => {
      const code = entryVariant.get(entryId);
      return code && (variantsByVersion.get(courseVersionId) ?? []).some((variant) => variant.code === code) ? code : undefined;
    };
    const rowsByClass = new Map<string, typeof parsedRows>();
    for (const row of parsedRows) {
      const classRowsForResult = rowsByClass.get(row.evaluation.classId) ?? [];
      classRowsForResult.push(row);
      rowsByClass.set(row.evaluation.classId, classRowsForResult);
    }
    const results: PublicResultV7[] = [];
    const orderedClasses = classIds.sort((left, right) => {
      const nameDifference = (classNameById.get(left) ?? "").localeCompare(classNameById.get(right) ?? "", "sv");
      return nameDifference || (left < right ? -1 : left > right ? 1 : 0);
    });
    for (const classId of orderedClasses) {
      const className = classNameById.get(classId);
      if (!className) throw new Error("Historisk resultatklass saknar namn");
      const classResultRows = rowsByClass.get(classId) ?? [];
      const rankingByKey = new Map(rankClassResults(classResultRows.map((row) => ({
        key: row.entryId,
        status: row.evaluation.status,
        ...(row.elapsedMs === undefined ? {} : { elapsedMs: row.elapsedMs }),
        courseVersionId: row.courseVersionId
      }))).map((ranking) => [ranking.key, ranking]));
      classResultRows.sort((left, right) => {
        if (left.evaluation.status !== right.evaluation.status) {
          return compareResultStatuses(left.evaluation.status, right.evaluation.status);
        }
        const elapsedDifference = (left.elapsedMs ?? Number.MAX_SAFE_INTEGER) -
          (right.elapsedMs ?? Number.MAX_SAFE_INTEGER);
        return elapsedDifference || left.familyName.localeCompare(right.familyName, "sv") ||
          left.givenName.localeCompare(right.givenName, "sv") ||
          (left.entryId < right.entryId ? -1 : left.entryId > right.entryId ? 1 : 0);
      });
      for (const row of classResultRows) {
        const ranking = rankingByKey.get(row.entryId);
        if (!ranking) throw new Error("Publicerat resultat saknar härledd rankingstate");
        if (row.evaluation.status === "NT") {
          results.push({
          className,
            publicResultId: row.publicResultId,
            givenName: row.givenName,
            familyName: row.familyName,
            organisationName: row.organisationName,
            revision: row.revision,
            status: "NT",
            reason: "WITHOUT_TIMING",
            rankingState: "NOT_RANKABLE_STATUS"
          });
          continue;
        }
        results.push({
          className,
          publicResultId: row.publicResultId,
          givenName: row.givenName,
          familyName: row.familyName,
          organisationName: row.organisationName,
          revision: row.revision,
          ...(variantOf(row.entryId, row.courseVersionId) ? { courseVariantCode: variantOf(row.entryId, row.courseVersionId) } : {}),
          status: row.evaluation.status,
          reason: row.evaluation.reason,
          ...(row.elapsedMs === undefined ? {} : { elapsedMs: row.elapsedMs }),
          missingControls: "missingControls" in row.evaluation ? row.evaluation.missingControls : [],
          extraPunches: "extraPunches" in row.evaluation ? row.evaluation.extraPunches : [],
          splits: ("splits" in row.evaluation ? row.evaluation.splits : []).map((split) => ({
            controlCode: split.controlCode,
            occurrence: split.occurrence,
            elapsedMs: split.elapsedMs,
            legMs: split.legMs
          })),
          rankingState: ranking.rankingState,
          ...(ranking.position === undefined ? {} : { position: ranking.position }),
          ...(ranking.timeBehindMs === undefined ? {} : { timeBehindMs: ranking.timeBehindMs })
        });
      }
    }
    return publicResultListResponseSchema.parse({
      formatVersion: 7,
      results
    });
  }, { isolationLevel: "repeatable read" });
}

export type PublicResultDetailLookup =
  | { status: "not-found" }
  | { status: "ok"; response: PublicResultDetailResponse };

/** Server-only historical course binding for another public projection. */
export async function resolvePublicActiveResultHead(
  tx: DatabaseTransaction,
  raceId: string,
  publicResultId: string
): Promise<{ resultRevisionId: string; resultRevision: number; entryId: string; courseVersionId: string; givenName: string; familyName: string; resultSplits: { status: "AVAILABLE"; splits: Array<{ controlCode: number; occurrence: number; legMs: number; elapsedMs: number }> } | { status: "UNAVAILABLE" }; resultStart: { status: "AVAILABLE"; startedAt: string } | { status: "UNAVAILABLE" } } | null> {
  if (!publicResultIdSchema.safeParse(publicResultId).success) return null;
  const rows = await selectPublishedPublicResultHeads(tx, raceId);
  const states = await resolveStoredResultHeadStates(tx, raceId, rows);
  const state = states.find((candidate) =>
    candidate.state === "ACTIVE_RESULT" && candidate.head.publicResultId === publicResultId
  );
  if (state?.state !== "ACTIVE_RESULT") return null;
  const evaluation = parseStrictStoredResultRevision(state.head,
    state.startCheckinDns?.source, state.finishTimeCorrection ?? undefined, state.finishTimeCorrectionWithdrawal ?? undefined,
    state.punchStartTimeCorrection ?? undefined, state.punchStartTimeCorrectionWithdrawal ?? undefined,
    state.shortenedCourseClassTransfer ?? undefined);
  const resultSplits = evaluation.status === "OK" && "elapsedMs" in evaluation && "splits" in evaluation && evaluation.splits.length > 0
    ? { status: "AVAILABLE" as const, splits: evaluation.splits.map((split) => ({ controlCode: split.controlCode, occurrence: split.occurrence, legMs: split.legMs, elapsedMs: split.elapsedMs })) }
    : { status: "UNAVAILABLE" as const };
  const startTime = "startTime" in evaluation ? evaluation.startTime : undefined;
  const resultStart = (evaluation.status === "OK" || evaluation.status === "MP") &&
    evaluation.reason !== "INVALID_TIME_ORDER" && typeof startTime === "string" && Number.isFinite(Date.parse(startTime))
    ? { status: "AVAILABLE" as const, startedAt: new Date(startTime).toISOString() }
    : { status: "UNAVAILABLE" as const };
  return { resultRevisionId: state.head.id, resultRevision: state.head.revision, entryId: state.head.entryId, courseVersionId: state.head.courseVersionId, givenName: state.head.givenName, familyName: state.head.familyName, resultSplits, resultStart };
}

/**
 * Race scope and the public list projection are both authoritative. Resolving
 * through the list keeps a detail response unable to grow a separate set of
 * result fields or expose an unpublished/non-active head.
 */
export async function publicResultDetail(
  db: Database,
  raceId: string,
  publicResultId: string
): Promise<PublicResultDetailLookup> {
  if (!publicResultIdSchema.safeParse(publicResultId).success) return { status: "not-found" };
  const results = await publicResults(db, raceId);
  const result = results.results.find((candidate) =>
    "publicResultId" in candidate && candidate.publicResultId === publicResultId
  );
  if (!result || !("publicResultId" in result)) return { status: "not-found" };
  return {
    status: "ok",
    response: publicResultDetailResponseSchema.parse({ formatVersion: 1, result })
  };
}

export async function resultHistory(db: Database, entryId: string) {
  return db.select().from(schema.resultRevisions)
    .where(eq(schema.resultRevisions.entryId, entryId))
    .orderBy(desc(schema.resultRevisions.revision));
}

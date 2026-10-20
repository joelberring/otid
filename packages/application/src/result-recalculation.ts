import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  resultRecalculationCandidateResponseSchema,
  resultRecalculationIdempotencyKeySchema,
  resultRecalculationRequestSchema,
  resultRecalculationResponseSchema,
  type ResultRecalculationCandidateResponse,
  type ResultRecalculationResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import {
  evaluateReadoutForEntry,
  RESULT_ENGINE_VERSION,
  snapshotForEntryCard
} from "@o-tid/domain";
import { latestResultReadout, latestResultReadouts, recalculationReadout } from "./card-reuse";
import { appendResultRevision, evaluateAndStore, normalizedReadout } from "./result-revisions";
import { loadRaceSnapshot } from "./snapshot";
import { lockEntryForRevision, lockRaceForSnapshot } from "./concurrency";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { isResultCurrent, loadResultBasisHashes } from "./result-basis";
import { UUID_PATTERN } from "./serialization";


/** Uttrycklig omräkning av en löpares resultat (delad från results.ts). */
export type ResultRecalculationCandidateListResult =
  | { status: "unauthorized" | "forbidden" }
  | { status: "ok"; response: ResultRecalculationCandidateResponse };

export async function listResultRecalculationCandidatesAsAdmin(
  db: Database,
  input: RaceSessionProof,
  now = new Date()
): Promise<ResultRecalculationCandidateListResult> {
  return db.transaction(async (tx) => {
    const authorization = await requireRaceRole(tx, {
      ...input,
      role: "ADMIN"
    }, now, "share");
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
    // Steg 31 (B4): den som har ett resultat räknas om från sin egen avläsning (resultatet följer avläsningen).
    const resultReadouts = await latestResultReadouts(tx, authorization.principal.raceId, entries.map((entry) => entry.id));
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
        const own = resultReadouts.get(entry.id);
        const chosen = assignment ? recalculationReadout(own, assignment.cardNumber, readoutByCard.get(assignment.cardNumber)) : undefined;
        const readout = chosen ? { id: chosen.id, readAt: chosen.readAt } : undefined;
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

export type AuthenticatedResultRecalculationInput = RaceSessionProof & {
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

  const preflightAuthorization = await requireRaceRole(db, {
    sessionToken: input.sessionToken,
    raceId: input.raceId,
    role: "ADMIN",
    csrfCookie: input.csrfCookie ?? null,
    csrfHeader: input.csrfHeader ?? null,
    requireCsrf: true
  }, recalculatedAt);
  if (preflightAuthorization.status !== "authenticated") return preflightAuthorization;

  const expectedLatestResultRevisionId = request.data.expectedLatestResultRevision?.id ?? null;
  const expectedLatestResultRevision = request.data.expectedLatestResultRevision?.revision ?? 0;
  return db.transaction(async (tx) => {
    const authorization = await requireRaceRole(tx, {
      sessionToken: input.sessionToken,
      raceId: input.raceId,
      role: "ADMIN",
      csrfCookie: input.csrfCookie ?? null,
      csrfHeader: input.csrfHeader ?? null,
      requireCsrf: true
    }, recalculatedAt, "update");
    if (authorization.status !== "authenticated") return authorization;

    await lockRaceForSnapshot(tx, authorization.principal.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existingRequest] = await tx.select().from(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.requestId, requestId));
    if (existingRequest) {
      const exact = existingRequest.actorAccountId === authorization.principal.accountId &&
        existingRequest.raceId === authorization.principal.raceId &&
        existingRequest.entryId === input.entryId &&
        existingRequest.expectedEntryVersion === request.data.expectedEntryVersion &&
        existingRequest.expectedClassId === request.data.expectedClassId &&
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

    const own = await latestResultReadout(tx, entry.id);
    const [byCard] = await tx.select().from(schema.cardReadouts).where(and(
      eq(schema.cardReadouts.raceId, authorization.principal.raceId),
      eq(schema.cardReadouts.cardNumber, assignment.cardNumber)
    )).orderBy(desc(schema.cardReadouts.readAt), desc(schema.cardReadouts.id)).limit(1);
    const readout = recalculationReadout(own, assignment.cardNumber, byCard);
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

    const snapshot = await loadRaceSnapshot(tx, authorization.principal.raceId);
    const evaluation = evaluateReadoutForEntry(normalizedReadout(readout), snapshot, entry.id);
    if (evaluation.entryId !== entry.id || !evaluation.courseVersionId) return { status: "conflict" };
    const createdResult = await appendResultRevision(tx, { raceId: authorization.principal.raceId, entryId: entry.id,
      readoutId: readout.id, cause: "EXPLICIT_RECALCULATION", outcome: evaluation, engineVersion: RESULT_ENGINE_VERSION,
      snapshotVersion: snapshot.race.snapshotVersion, courseVersionId: evaluation.courseVersionId });
    const [savedRequest] = await tx.insert(schema.resultRecalculationRequests).values({
      requestId,
      raceId: authorization.principal.raceId,
      actorAccountId: authorization.principal.accountId,
      entryId: entry.id,
      expectedEntryVersion: request.data.expectedEntryVersion,
      expectedClassId: request.data.expectedClassId,
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
      actorKind: "USER_ACCOUNT",
      actorId: authorization.principal.accountId,
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
    const own = await latestResultReadout(tx, entryId);
    if (!assignment && !own) throw new Error("Deltagaren saknar aktiv bricka");
    const [byCard] = assignment ? await tx.select().from(schema.cardReadouts).where(and(
      eq(schema.cardReadouts.raceId, raceId), eq(schema.cardReadouts.cardNumber, assignment.cardNumber)
    )).orderBy(desc(schema.cardReadouts.readAt)).limit(1) : [];
    const readout = recalculationReadout(own, assignment?.cardNumber, byCard);
    if (!readout) throw new Error("Deltagaren saknar avläsning");
    const snapshot = await loadRaceSnapshot(tx, raceId);
    const stored = await evaluateAndStore(tx, snapshotForEntryCard(snapshot, entryId, readout.cardNumber), normalizedReadout(readout),
      "CLASS_CHANGE_RECALCULATION", { entryId });
    if (!stored.stored) throw new Error("Avläsningen kan inte kopplas till deltagaren");
    const { evaluation, revision: created } = stored;
    const revision = created.revision;
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

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  entryClassAdminListResponseSchema,
  entryClassChangeIdempotencyKeySchema,
  entryClassChangeRequestSchema,
  entryClassChangeResponseSchema,
  publicResultDetailResponseSchema,
  publicResultIdSchema,
  publicResultListResponseSchema,
  publicResultV7Schema,
  type EntryClassAdminListResponse,
  type EntryClassChangeResponse,
  type PublicResultDetailResponse,
  type PublicResultListResponse,
  type PublicResultV7
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import {
  compareResultStatuses,
  rankClassResults
} from "@o-tid/domain";
import { loadCourseVersionVariants, variantAfterClassChange } from "./course-variants";
import { bumpReadoutPackageVersion } from "./snapshot";
import { lockEntryForRevision, lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { parseStrictStoredResultRevision } from "./stored-result-revision";
import { canAddClassEntry, ClassCapacityConflictError } from "./class-capacity-guard";
import { UUID_PATTERN } from "./serialization";

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
    startCheckinDnsDecisionId: schema.resultRevisions.startCheckinDnsDecisionId,
    controlNeutralizationId: schema.resultRevisions.controlNeutralizationId,
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
    await bumpReadoutPackageVersion(tx, raceId);
    return updated;
  });
}

export type EntryClassAdminListResult =
  | { status: "unauthorized" | "forbidden" }
  | { status: "ok"; response: EntryClassAdminListResponse };

export async function listEntryClassesAsAdmin(
  db: Database,
  input: RaceSessionProof,
  now = new Date()
): Promise<EntryClassAdminListResult> {
  return db.transaction(async (tx) => {
    const authorization = await requireRaceRole(tx, {
      ...input,
      role: "ADMIN"
    }, now, "share");
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

export type AuthenticatedEntryClassChangeInput = RaceSessionProof & {
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

  const preflightAuthorization = await requireRaceRole(db, {
    sessionToken: input.sessionToken,
    raceId: input.raceId,
    role: "ADMIN",
    csrfCookie: input.csrfCookie ?? null,
    csrfHeader: input.csrfHeader ?? null,
    requireCsrf: true
  }, changedAt);
  if (preflightAuthorization.status !== "authenticated") return preflightAuthorization;

  return db.transaction(async (tx) => {
    const authorization = await requireRaceRole(tx, {
      sessionToken: input.sessionToken,
      raceId: input.raceId,
      role: "ADMIN",
      csrfCookie: input.csrfCookie ?? null,
      csrfHeader: input.csrfHeader ?? null,
      requireCsrf: true
    }, changedAt, "update");
    if (authorization.status !== "authenticated") return authorization;

    const race = await lockRaceForMutation(tx, authorization.principal.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existingRequest] = await tx.select().from(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.requestId, requestId));
    if (existingRequest) {
      const exact = existingRequest.actorAccountId === authorization.principal.accountId &&
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
    await bumpReadoutPackageVersion(tx, authorization.principal.raceId);
    const [savedRequest] = await tx.insert(schema.entryClassChangeRequests).values({
      requestId,
      raceId: authorization.principal.raceId,
      actorAccountId: authorization.principal.accountId,
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
      actorKind: "USER_ACCOUNT",
      actorId: authorization.principal.accountId,
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
      const evaluation = parseStrictStoredResultRevision(row, state.startCheckinDns?.source);
      return {
        ...row,
        evaluation,
        elapsedMs: "elapsedMs" in evaluation ? evaluation.elapsedMs : undefined,
        // Rogaining (ADR-0170 beslut 5): poängen rangordnar klassen.
        rogaining: "rogaining" in evaluation ? evaluation.rogaining : undefined
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
        ...(row.rogaining === undefined ? {} : { score: row.rogaining.total }),
        courseVersionId: row.courseVersionId
      }))).map((ranking) => [ranking.key, ranking]));
      classResultRows.sort((left, right) => {
        if (left.evaluation.status !== right.evaluation.status) {
          return compareResultStatuses(left.evaluation.status, right.evaluation.status);
        }
        const scoreDifference = (right.rogaining?.total ?? -1) - (left.rogaining?.total ?? -1);
        if (scoreDifference !== 0) return scoreDifference;
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
          ...(ranking.timeBehindMs === undefined ? {} : { timeBehindMs: ranking.timeBehindMs }),
          ...(row.rogaining === undefined ? {} : { rogaining: row.rogaining })
        });
      }
    }
    return publicResultListResponseSchema.parse({
      formatVersion: 7,
      results: results.flatMap((row) => publicRow(row, raceId))
    });
  }, { isolationLevel: "repeatable read" });
}

/**
 * PLAN.md steg 13: en enskild rad som inte passar det publika formatet får aldrig fälla hela resultatlistan.
 * Raden visas då utan tekniska detaljer (sträcktider, saknade och extra kontroller); går inte heller det
 * utelämnas den. Båda fallen loggas utan namn så att felet kan följas upp.
 */
function publicRow(row: PublicResultV7, raceId: string): PublicResultV7[] {
  if (publicResultV7Schema.safeParse(row).success) return [row];
  const reduced = "splits" in row ? { ...row, splits: [], missingControls: [], extraPunches: [] } : row;
  const parsed = publicResultV7Schema.safeParse(reduced);
  console.error(parsed.success
    ? `Publikt resultat visas utan sträcktider: ogiltiga tekniska detaljer (lopp ${raceId}, resultat ${row.publicResultId})`
    : `Publikt resultat utelämnat: ogiltig rad (lopp ${raceId}, resultat ${row.publicResultId})`);
  return parsed.success ? [parsed.data] : [];
}

export type PublicResultDetailLookup =
  | { status: "not-found" }
  | { status: "ok"; response: PublicResultDetailResponse };

/** Tider för ett publicerat individuellt resultat: starttid, sträcktider och löptid (vägval, PLAN.md steg 16). */
export type PublicResultTiming = {
  entryId: string; publicResultId: string; givenName: string; familyName: string; classId: string; status: string;
  /** Starttiden som klockslag i ms, eller null när den saknas. */
  startMs: number | null;
  splits: { controlCode: number; occurrence: number; elapsedMs: number }[];
  elapsedMs: number | null;
};

/**
 * Server-only: starttid och stämplingstider för alla publicerade, aktiva individuella resultat i loppet. Samma
 * urval och tolkning som den publika resultatlistan, så att vägvalen aldrig visar något som listan inte visar.
 */
export async function publicResultTimings(tx: DatabaseTransaction, raceId: string): Promise<PublicResultTiming[]> {
  const rows = (await selectPublishedPublicResultHeads(tx, raceId)).filter((row) => row.teamId === null);
  const states = await resolveStoredResultHeadStates(tx, raceId, rows);
  return states.flatMap((state) => {
    if (state.state !== "ACTIVE_RESULT") return [];
    const evaluation = parseStrictStoredResultRevision(state.head, state.startCheckinDns?.source);
    const startTime = "startTime" in evaluation ? evaluation.startTime : undefined;
    const startMs = typeof startTime === "string" && evaluation.reason !== "INVALID_TIME_ORDER" ? Date.parse(startTime) : Number.NaN;
    return [{
      entryId: state.head.entryId, publicResultId: state.head.publicResultId, givenName: state.head.givenName,
      familyName: state.head.familyName, classId: evaluation.classId, status: evaluation.status,
      startMs: Number.isFinite(startMs) ? startMs : null,
      splits: ("splits" in evaluation ? evaluation.splits : []).map((split) => ({ controlCode: split.controlCode,
        occurrence: split.occurrence, elapsedMs: split.elapsedMs })),
      elapsedMs: "elapsedMs" in evaluation && typeof evaluation.elapsedMs === "number" ? evaluation.elapsedMs : null
    }];
  });
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

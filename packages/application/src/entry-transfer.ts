import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { entryTransferCandidatesSchema, entryTransferIdempotencyKeySchema,
  entryTransferRequestSchema, entryTransferResponseSchema,
  speakerBoardEffectiveResultSchema, type SpeakerBoardEffectiveResult } from "@o-tid/contracts";
import { authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { canAddClassEntry } from "./class-capacity-guard";
import { loadRelayClassConfigs, loadRelayTeams } from "./relay-model";
import { loadCourseVersionVariants, variantAfterClassChange } from "./course-variants";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { isEffectiveResultCurrent, loadResultBasisHashes } from "./result-basis";
import { parseAdministratorStoredResultHead } from "./administrator-effective-result";
import { loadStartListFacts } from "./start-draw-basis";

type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxVersion = 2_147_483_647;

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function guardResultFreshnessHistory(tx: Transaction, raceId: string, entryIds: string[]) {
  if (entryIds.length === 0) return;
  let count = 0;
  for (const table of [schema.resultDisqualificationDecisions, schema.resultApprovalDecisions,
    schema.didNotFinishDecisions, schema.notCompetingDecisions, schema.withoutTimingDecisions,
    schema.startCheckinDnsDecisions]) {
    const decisions = await tx.select({ id: table.id }).from(table).where(and(
      eq(table.raceId, raceId), inArray(table.entryId, entryIds)
    )).limit(1_001);
    count += decisions.length;
    if (count > 1_000) throw new Error("Deltagarlistans beslutshistorik är för stor");
  }
}

/**
 * Arbetsytans ögonblicksbild (klasser och deltagare). Funktionären läser den också: startlistan, direktanmälan
 * och kvar i skogen bygger på den (ADR-0172 beslut 3). Klassbytet nedan kräver administratör.
 */
export async function listEntryTransfersAsAdministrator(db: Database, input: Authentication, now = new Date()) {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" as const };
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability: "RACE_FUNCTIONARY" }, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForSnapshot(tx, input.raceId);
    const [metadata] = await tx.select({ eventName: schema.events.name, raceName: schema.races.name,
      raceDate: schema.races.raceDate, raceType: schema.races.raceType, timeZone: schema.events.timeZone })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(schema.races.id, input.raceId));
    if (!metadata) throw new Error("Loppets metadata saknas");
    const classRows = await tx.select({ id: schema.classes.id, name: schema.classes.name,
      courseVersionId: schema.classes.courseVersionId, startRule: schema.classes.startRule, courseRaceId: schema.courses.raceId,
      courseName: schema.courses.name, courseVersion: schema.courseVersions.version,
      maxEntries: schema.classes.maxEntries, capacityVersion: schema.classes.capacityVersion, startDrawId: schema.classes.startDrawId
    }).from(schema.classes).leftJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
      .leftJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
      .where(eq(schema.classes.raceId, input.raceId)).orderBy(asc(schema.classes.name), asc(schema.classes.id)).limit(1001);
    if (classRows.some(row => row.courseRaceId !== input.raceId || row.courseName === null || row.courseVersion === null)) {
      throw new Error("Ogiltig klass–ban-koppling");
    }
    const rows = await tx.select({ id: schema.entries.id, givenName: schema.entries.givenName,
      familyName: schema.entries.familyName, organisationName: schema.entries.organisationName,
      classId: schema.entries.classId, version: schema.entries.version, paymentStatus: schema.entries.paymentStatus,
      paymentStatusVersion: schema.entries.paymentStatusVersion, fixedStartTime: schema.entries.fixedStartTime,
      courseVariantCode: schema.entries.courseVariantCode, teamId: schema.entries.teamId, relayLeg: schema.entries.relayLeg,
      exactTime: sql<boolean>`${schema.entries.fixedStartTime} IS NULL OR date_trunc('milliseconds', ${schema.entries.fixedStartTime}) = ${schema.entries.fixedStartTime}`
    }).from(schema.entries).where(eq(schema.entries.raceId, input.raceId))
      .orderBy(asc(schema.entries.familyName), asc(schema.entries.givenName), asc(schema.entries.id)).limit(10_001);
    if (rows.some(row => !row.exactTime)) throw new Error("Starttidens precision stöds inte");
    if (rows.length > 10_000) throw new Error("För många deltagare");
    const assignments = await tx.select({ id: schema.cardAssignments.id, entryId: schema.cardAssignments.entryId,
      cardNumber: schema.cardAssignments.cardNumber, isRental: schema.cardAssignments.isRental,
      rentalReturned: schema.cardAssignments.rentalReturned }).from(schema.cardAssignments)
      .where(and(eq(schema.cardAssignments.raceId, input.raceId), eq(schema.cardAssignments.active, true))).limit(20_001);
    if (assignments.length > 20_000) throw new Error("För många aktiva brickkopplingar");
    const entryIds = new Set(rows.map(row => row.id));
    const latestPublished = tx.selectDistinctOn([schema.resultRevisions.entryId], {
      ...getTableColumns(schema.resultRevisions)
    }).from(schema.resultRevisions).where(and(
      eq(schema.resultRevisions.raceId, input.raceId), eq(schema.resultRevisions.published, true)
    )).orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision),
      desc(schema.resultRevisions.id)).as("administrator_roster_latest_published");
    const publishedHeads = await tx.select().from(latestPublished).limit(10_001);
    if (publishedHeads.length > 10_000 || publishedHeads.some(head => !entryIds.has(head.entryId))) {
      throw new Error("Deltagarlistans publicerade resultathuvuden är ogiltiga");
    }
    await guardResultFreshnessHistory(tx, input.raceId, publishedHeads.map(head => head.entryId));
    // ADR-0169: CURRENT_SNAPSHOT/OLDER_SNAPSHOT avgörs av löparens eget bedömningsunderlag.
    const basisHashes = await loadResultBasisHashes(tx, input.raceId);
    const freshnessByEntry = new Map<string, "NO_ACTIVE_RESULT" | "CURRENT_SNAPSHOT" | "OLDER_SNAPSHOT">();
    const effectiveResultByEntry = new Map<string, {
      state: "NO_ACTIVE_RESULT"; selectedRevision: { id: string; revision: number }
    } | {
      state: "ACTIVE_RESULT"; selectedRevision: { id: string; revision: number };
      resultSnapshotVersion: number; result: SpeakerBoardEffectiveResult
    }>();
    const revisionMarkerByEntry = new Map<string, "MANUAL_FINISH_TIME_CORRECTION" | "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" | null>();
    for (const state of await resolveStoredResultHeadStates(tx, input.raceId, publishedHeads)) {
      if (freshnessByEntry.has(state.selectedHead.entryId)) throw new Error("Deltagarlistan har dubbla resultathuvuden");
      if (state.finishTimeCorrection !== null && state.finishTimeCorrectionWithdrawal !== null) {
        throw new Error("Deltagarlistans måltidsrättningskedja är motsägande");
      }
      revisionMarkerByEntry.set(state.selectedHead.entryId, state.finishTimeCorrection !== null
        ? "MANUAL_FINISH_TIME_CORRECTION"
        : state.finishTimeCorrectionWithdrawal !== null ? "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" : null);
      const selectedRevision = { id: state.selectedHead.id, revision: state.selectedHead.revision };
      const outcome = parseAdministratorStoredResultHead(state);
      const result = speakerBoardEffectiveResultSchema.parse({ revision: state.head.revision,
        status: outcome.status, reason: outcome.reason,
        ...("elapsedMs" in outcome ? { elapsedMs: outcome.elapsedMs } : {}) });
      if (state.state === "NO_ACTIVE_RESULT") {
        freshnessByEntry.set(state.selectedHead.entryId, "NO_ACTIVE_RESULT");
        effectiveResultByEntry.set(state.selectedHead.entryId, { state: "NO_ACTIVE_RESULT", selectedRevision });
      } else if (state.head.snapshotVersion > race.snapshotVersion) {
        throw new Error("Deltagarlistans gällande resultat kommer från en framtida snapshot");
      } else {
        const current = isEffectiveResultCurrent(state, basisHashes.get(state.selectedHead.entryId), race.snapshotVersion);
        freshnessByEntry.set(state.selectedHead.entryId, current ? "CURRENT_SNAPSHOT" : "OLDER_SNAPSHOT");
        effectiveResultByEntry.set(state.selectedHead.entryId, { state: "ACTIVE_RESULT", selectedRevision,
          resultSnapshotVersion: state.head.snapshotVersion, result });
      }
    }
    if (freshnessByEntry.size !== publishedHeads.length || revisionMarkerByEntry.size !== publishedHeads.length ||
      effectiveResultByEntry.size !== publishedHeads.length) {
      throw new Error("Deltagarlistans resultathuvuden kunde inte resolveras");
    }
    const activeByEntry = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      if (!entryIds.has(assignment.entryId)) throw new Error("Brickkopplingens deltagare saknas i loppet");
      const active = activeByEntry.get(assignment.entryId) ?? [];
      active.push(assignment); activeByEntry.set(assignment.entryId, active);
    }
    const entryCounts = new Map<string, number>();
    for (const row of rows) entryCounts.set(row.classId, (entryCounts.get(row.classId) ?? 0) + 1);
    const variants = await loadCourseVersionVariants(tx, classRows.map(row => row.courseVersionId));
    const relayClasses = await loadRelayClassConfigs(tx, input.raceId);
    const teams = new Map((relayClasses.size === 0 ? [] : await loadRelayTeams(tx, input.raceId)).map(team => [team.id, team]));
    const startFacts = await loadStartListFacts(tx, input.raceId);
    return { status: "ok" as const, response: entryTransferCandidatesSchema.parse({
      formatVersion: 2, raceId: input.raceId, snapshotVersion: race.snapshotVersion,
      generatedAt: now.toISOString(), ...metadata,
      classes: classRows.map(row => ({ id: row.id, name: row.name, courseVersionId: row.courseVersionId,
        courseName: row.courseName, courseVersion: row.courseVersion, startRule: row.startRule,
        maxEntries: row.maxEntries, capacityVersion: row.capacityVersion, entryCount: entryCounts.get(row.id) ?? 0,
        startDrawn: row.startDrawId !== null,
        courseVariants: (variants.get(row.courseVersionId) ?? []).map(variant => variant.code),
        ...(relayClasses.has(row.id) ? { relayLegCount: relayClasses.get(row.id)!.legs.length } : {}),
        ...startFacts.get(row.id) })),
      entries: rows.map(row => {
        const active = activeByEntry.get(row.id) ?? [];
        const assignment = active.length === 1 ? active[0] : undefined;
        return {
        id: row.id, classId: row.classId, version: row.version, paymentStatus: row.paymentStatus,
        paymentStatusVersion: row.paymentStatusVersion, organisationName: row.organisationName,
        displayName: `${row.givenName} ${row.familyName}`, fixedStartTime: row.fixedStartTime?.toISOString() ?? null,
        courseVariantCode: row.courseVariantCode,
        ...(row.teamId && row.relayLeg ? { relay: { teamId: row.teamId, teamNumber: teams.get(row.teamId)!.number,
          teamName: teams.get(row.teamId)!.name, leg: row.relayLeg } } : {}),
        resultFreshness: freshnessByEntry.get(row.id) ?? "NO_PUBLISHED_RESULT",
        effectiveResult: effectiveResultByEntry.get(row.id) ?? { state: "NO_PUBLISHED_RESULT", selectedRevision: null },
        resultRevisionMarker: revisionMarkerByEntry.get(row.id) ?? null,
        activeAssignment: assignment ? { id: assignment.id, cardNumber: assignment.cardNumber,
          isRental: assignment.isRental, rentalReturned: assignment.rentalReturned } : null,
        multipleActiveAssignments: active.length > 1
      }; })
    }) };
  }, { isolationLevel: "repeatable read" });
}

function receipt(row: typeof schema.entryTransferRequests.$inferSelect, replayed: boolean) {
  const request = entryTransferRequestSchema.parse(row.request);
  if (row.capability !== capability || row.previousClassId !== request.expectedClassId ||
    row.targetClassId !== request.targetClassId || row.entryVersionBefore !== request.expectedEntryVersion ||
    row.snapshotVersionBefore !== request.expectedSnapshotVersion) throw new Error("Ogiltig bytesjournal");
  return entryTransferResponseSchema.parse({ formatVersion: 1, replayed, requestId: row.requestId,
    raceId: row.raceId, entryId: row.entryId, request, entryVersionAfter: row.entryVersionAfter,
    snapshotVersionAfter: row.snapshotVersionAfter, changedAt: row.changedAt.toISOString() });
}

export async function transferEntryAsAdministrator(db: Database,
  input: Authentication & { entryId: string; idempotencyKey: string | null; request: unknown }, now = new Date()) {
  const key = entryTransferIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const parsed = entryTransferRequestSchema.safeParse(input.request);
  if (!key.success || !parsed.success || !uuid.test(input.raceId) || !uuid.test(input.entryId)) return { status: "invalid-request" as const };
  const intent = parsed.data, requestId = key.data.slice("entry-transfer:".length);
  const authentication = { ...input, capability, requireCsrf: true };
  const preflight = await authenticatePairingAdminSession(db, authentication, now);
  if (preflight.status !== "authenticated") return preflight;
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.entryTransferRequests).where(eq(schema.entryTransferRequests.requestId, requestId));
    if (existing) {
      const original = receipt(existing, true);
      if (existing.raceId !== input.raceId || existing.entryId !== input.entryId ||
        existing.actorCredentialId !== auth.principal.accessCredentialId ||
        JSON.stringify(original.request) !== JSON.stringify(intent)) return { status: "conflict" as const };
      return { status: "transferred" as const, response: original };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= maxVersion) return { status: "conflict" as const };
    const [entry] = await tx.select({ row: schema.entries,
      exactTime: sql<boolean>`${schema.entries.fixedStartTime} IS NULL OR date_trunc('milliseconds', ${schema.entries.fixedStartTime}) = ${schema.entries.fixedStartTime}`
    }).from(schema.entries).where(and(eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, input.raceId))).for("update");
    if (!entry) return { status: "not-found" as const };
    if (!entry.exactTime || entry.row.version >= maxVersion || entry.row.version !== intent.expectedEntryVersion ||
      entry.row.classId !== intent.expectedClassId ||
      (entry.row.fixedStartTime?.toISOString() ?? null) !== intent.expectedFixedStartTime ||
      entry.row.teamId !== null) return { status: "conflict" as const };
    const [target] = await tx.select({ courseVersionId: schema.classes.courseVersionId, startRule: schema.classes.startRule })
      .from(schema.classes).innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId)).where(and(
        eq(schema.classes.id, intent.targetClassId), eq(schema.classes.raceId, input.raceId), eq(schema.courses.raceId, input.raceId)));
    if (!target || target.courseVersionId !== intent.expectedTargetCourseVersionId || target.startRule !== intent.expectedTargetStartRule) {
      return { status: "conflict" as const };
    }
    if (!await canAddClassEntry(tx, input.raceId, intent.targetClassId)) return { status: "conflict" as const };
    const entryVersionAfter = entry.row.version + 1, snapshotVersionAfter = race.snapshotVersion + 1;
    const courseVariantCode = await variantAfterClassChange(tx, input.raceId, input.entryId, intent.targetClassId,
      entry.row.courseVariantCode);
    await tx.update(schema.entries).set({ classId: intent.targetClassId, courseVariantCode,
      fixedStartTime: intent.fixedStartTime === null ? null : new Date(intent.fixedStartTime), version: entryVersionAfter
    }).where(and(eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, input.raceId)));
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, input.raceId));
    const [saved] = await tx.insert(schema.entryTransferRequests).values({ requestId, raceId: input.raceId,
      entryId: input.entryId, actorCredentialId: auth.principal.accessCredentialId, capability,
      previousClassId: intent.expectedClassId, targetClassId: intent.targetClassId, request: intent,
      entryVersionBefore: entry.row.version, entryVersionAfter, snapshotVersionBefore: race.snapshotVersion,
      snapshotVersionAfter, changedAt: now }).returning();
    if (!saved) throw new Error("Bytesjournalen kunde inte sparas");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "entry", entityId: input.entryId,
      action: "ENTRY_CLASS_AND_START_TRANSFERRED_BY_ADMIN", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL",
      actorId: auth.principal.accessCredentialId, requestId,
      before: { classId: intent.expectedClassId, fixedStartTime: intent.expectedFixedStartTime,
        entryVersion: entry.row.version, snapshotVersion: race.snapshotVersion },
      after: { classId: intent.targetClassId, fixedStartTime: intent.fixedStartTime, entryVersion: entryVersionAfter, snapshotVersion: snapshotVersionAfter }
    });
    return { status: "transferred" as const, response: receipt(saved, false) };
  });
}

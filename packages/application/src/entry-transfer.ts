import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { entryTransferCandidatesSchema, entryTransferIdempotencyKeySchema,
  entryTransferRequestSchema, entryTransferResponseSchema, entryTransferStartSlotCandidatesSchema,
  speakerBoardEffectiveResultSchema, type SpeakerBoardEffectiveResult } from "@o-tid/contracts";
import { authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { canAddClassEntry } from "./class-capacity-guard";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { isEffectiveResultCurrent, loadResultBasisHashes } from "./result-basis";
import { parseAdministratorStoredResultHead } from "./administrator-effective-result";
import { resolveVerifiedFixedStartSlotPlan } from "./verified-fixed-start-slot";

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

export async function listEntryTransfersAsAdministrator(db: Database, input: Authentication, now = new Date()) {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" as const };
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForSnapshot(tx, input.raceId);
    const [metadata] = await tx.select({ eventName: schema.events.name, raceName: schema.races.name,
      raceDate: schema.races.raceDate, timeZone: schema.events.timeZone })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(schema.races.id, input.raceId));
    if (!metadata) throw new Error("Loppets metadata saknas");
    const classRows = await tx.select({ id: schema.classes.id, name: schema.classes.name,
      courseVersionId: schema.classes.courseVersionId, startRule: schema.classes.startRule, courseRaceId: schema.courses.raceId,
      courseName: schema.courses.name, courseVersion: schema.courseVersions.version,
      maxEntries: schema.classes.maxEntries, capacityVersion: schema.classes.capacityVersion
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
    return { status: "ok" as const, response: entryTransferCandidatesSchema.parse({
      formatVersion: 2, raceId: input.raceId, snapshotVersion: race.snapshotVersion,
      generatedAt: now.toISOString(), ...metadata,
      classes: classRows.map(row => ({ id: row.id, name: row.name, courseVersionId: row.courseVersionId,
        courseName: row.courseName, courseVersion: row.courseVersion, startRule: row.startRule,
        maxEntries: row.maxEntries, capacityVersion: row.capacityVersion, entryCount: entryCounts.get(row.id) ?? 0 })),
      entries: rows.map(row => {
        const active = activeByEntry.get(row.id) ?? [];
        const assignment = active.length === 1 ? active[0] : undefined;
        return {
        id: row.id, classId: row.classId, version: row.version, paymentStatus: row.paymentStatus,
        paymentStatusVersion: row.paymentStatusVersion, organisationName: row.organisationName,
        displayName: `${row.givenName} ${row.familyName}`, fixedStartTime: row.fixedStartTime?.toISOString() ?? null,
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

type SlotAssignment = typeof schema.entryStartSlotAssignments.$inferSelect;
function receipt(row: typeof schema.entryTransferRequests.$inferSelect, assignment: SlotAssignment | undefined, replayed: boolean) {
  const request = entryTransferRequestSchema.parse(row.request);
  if (row.capability !== capability || row.previousClassId !== request.expectedClassId ||
    row.targetClassId !== request.targetClassId || row.entryVersionBefore !== request.expectedEntryVersion ||
    row.snapshotVersionBefore !== request.expectedSnapshotVersion) throw new Error("Ogiltig bytesjournal");
  return entryTransferResponseSchema.parse({ formatVersion: 1, replayed, requestId: row.requestId,
    raceId: row.raceId, entryId: row.entryId, request, entryVersionAfter: row.entryVersionAfter,
    snapshotVersionAfter: row.snapshotVersionAfter, changedAt: row.changedAt.toISOString(), assignedStartSlot: assignment
      ? { assignmentId: assignment.id, drawRequestId: assignment.drawRequestId, sourceHash: assignment.sourceHash,
        fixedStartTime: assignment.fixedStartTime.toISOString() } : null });
}

export async function listEntryTransferStartSlotsAsAdministrator(db: Database,
  input: Authentication & { entryId: string; targetClassId: string }, now = new Date()) {
  if (!uuid.test(input.raceId) || !uuid.test(input.entryId) || !uuid.test(input.targetClassId)) return { status: "invalid-request" as const };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForSnapshot(tx, input.raceId);
    const [entry] = await tx.select({ classId: schema.entries.classId }).from(schema.entries).where(and(
      eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, input.raceId))).limit(1);
    const [target] = await tx.select({ courseVersionId: schema.classes.courseVersionId, startRule: schema.classes.startRule,
      capacityVersion: schema.classes.capacityVersion }).from(schema.classes).where(and(
        eq(schema.classes.id, input.targetClassId), eq(schema.classes.raceId, input.raceId))).limit(1);
    if (!entry || !target) return { status: "not-found" as const };
    if (entry.classId === input.targetClassId || target.startRule !== "FIXED") return { status: "conflict" as const };
    const plan = await resolveVerifiedFixedStartSlotPlan(tx, input.raceId, input.targetClassId, now);
    return { status: "ok" as const, response: entryTransferStartSlotCandidatesSchema.parse({ formatVersion: 1,
      raceId: input.raceId, entryId: input.entryId, targetClassId: input.targetClassId, snapshotVersion: race.snapshotVersion,
      targetCourseVersionId: target.courseVersionId, targetCapacityVersion: target.capacityVersion, startRule: "FIXED", plan: plan.status === "AVAILABLE"
        ? { status: plan.status, drawRequestId: plan.drawRequestId, sourceHash: plan.sourceHash,
          slots: plan.slots.map(fixedStartTime => ({ fixedStartTime })) }
        : plan }) };
  }, { isolationLevel: "repeatable read" });
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
      const [assignment] = await tx.select().from(schema.entryStartSlotAssignments)
        .where(eq(schema.entryStartSlotAssignments.transferRequestId, existing.id));
      const original = receipt(existing, assignment, true);
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
      (entry.row.fixedStartTime?.toISOString() ?? null) !== intent.expectedFixedStartTime) return { status: "conflict" as const };
    const [target] = await tx.select({ courseVersionId: schema.classes.courseVersionId, startRule: schema.classes.startRule,
      capacityVersion: schema.classes.capacityVersion })
      .from(schema.classes).innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId)).where(and(
        eq(schema.classes.id, intent.targetClassId), eq(schema.classes.raceId, input.raceId), eq(schema.courses.raceId, input.raceId)));
    if (!target || target.courseVersionId !== intent.expectedTargetCourseVersionId || target.startRule !== intent.expectedTargetStartRule ||
      (intent.expectedTargetCapacityVersion !== undefined && target.capacityVersion !== intent.expectedTargetCapacityVersion)) {
      return { status: "conflict" as const };
    }
    if (!await canAddClassEntry(tx, input.raceId, intent.targetClassId)) return { status: "conflict" as const };
    if (intent.assignedStartSlot !== undefined && intent.assignedStartSlot !== null) {
      const plan = await resolveVerifiedFixedStartSlotPlan(tx, input.raceId, intent.targetClassId, now);
      if (plan.status !== "AVAILABLE" || plan.drawRequestId !== intent.assignedStartSlot.drawRequestId ||
        plan.sourceHash !== intent.assignedStartSlot.sourceHash || !plan.slots.includes(intent.assignedStartSlot.fixedStartTime)) {
        return { status: "conflict" as const };
      }
    }
    const entryVersionAfter = entry.row.version + 1, snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.entries).set({ classId: intent.targetClassId,
      fixedStartTime: intent.fixedStartTime === null ? null : new Date(intent.fixedStartTime), version: entryVersionAfter
    }).where(and(eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, input.raceId)));
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, input.raceId));
    const [saved] = await tx.insert(schema.entryTransferRequests).values({ requestId, raceId: input.raceId,
      entryId: input.entryId, actorCredentialId: auth.principal.accessCredentialId, capability,
      previousClassId: intent.expectedClassId, targetClassId: intent.targetClassId, request: intent,
      entryVersionBefore: entry.row.version, entryVersionAfter, snapshotVersionBefore: race.snapshotVersion,
      snapshotVersionAfter, changedAt: now }).returning();
    if (!saved) throw new Error("Bytesjournalen kunde inte sparas");
    let assignment: SlotAssignment | undefined;
    if (intent.assignedStartSlot !== undefined && intent.assignedStartSlot !== null) {
      const [savedAssignment] = await tx.insert(schema.entryStartSlotAssignments).values({
        transferRequestId: saved.id, raceId: input.raceId, entryId: input.entryId, targetClassId: intent.targetClassId,
        drawRequestId: intent.assignedStartSlot.drawRequestId, sourceHash: intent.assignedStartSlot.sourceHash,
        fixedStartTime: new Date(intent.assignedStartSlot.fixedStartTime), actorCredentialId: auth.principal.accessCredentialId,
        capability, assignedAt: now
      }).returning();
      if (!savedAssignment) throw new Error("Startslotsjournalen kunde inte sparas");
      assignment = savedAssignment;
    }
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "entry", entityId: input.entryId,
      action: "ENTRY_CLASS_AND_START_TRANSFERRED_BY_ADMIN", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL",
      actorId: auth.principal.accessCredentialId, requestId,
      before: { classId: intent.expectedClassId, fixedStartTime: intent.expectedFixedStartTime,
        entryVersion: entry.row.version, snapshotVersion: race.snapshotVersion },
      after: { classId: intent.targetClassId, fixedStartTime: intent.fixedStartTime, entryVersion: entryVersionAfter, snapshotVersion: snapshotVersionAfter }
    });
    return { status: "transferred" as const, response: receipt(saved, assignment, false) };
  });
}

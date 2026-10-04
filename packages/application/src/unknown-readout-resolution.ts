import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  unknownReadoutResolutionCandidateResponseSchema,
  unknownReadoutResolutionIdempotencyKeySchema,
  unknownReadoutResolutionRequestSchema,
  unknownReadoutResolutionResponseSchema,
  type UnknownReadoutResolutionCandidateResponse,
  type UnknownReadoutResolutionResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  courseVariantForReadout, evaluateCardReadout, RESULT_ENGINE_VERSION, withProposedEntryVariants, type NormalizedCardReadout
} from "@o-tid/domain";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { loadRaceSnapshot } from "./snapshot";
import { appliedControlNeutralization } from "./class-control-neutralization";
import { canAddClassEntry } from "./class-capacity-guard";
import { relayTeamOfEntry } from "./relay-model";
import { synchronizeRelayTeams } from "./relay-sync";

type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_RACE" as const;

function isUnknownOutcome(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  return outcome.status === "UNKNOWN_CARD" && outcome.reason === "UNKNOWN_CARD";
}

export type UnknownReadoutResolutionCandidateResult =
  | { status: "unauthorized" | "forbidden" }
  | { status: "ok"; response: UnknownReadoutResolutionCandidateResponse };

export async function listUnknownReadoutResolutionCandidatesAsAdministrator(
  db: Database,
  input: Authentication,
  now = new Date()
): Promise<UnknownReadoutResolutionCandidateResult> {
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForSnapshot(tx, input.raceId);
    const resolved = await tx.select({ readoutId: schema.unknownReadoutResolutions.readoutId })
      .from(schema.unknownReadoutResolutions).where(eq(schema.unknownReadoutResolutions.raceId, input.raceId));
    const resolvedIds = new Set(resolved.map((row) => row.readoutId));
    const readoutRows = await tx.select({
      id: schema.cardReadouts.id,
      cardNumber: schema.cardReadouts.cardNumber,
      readAt: schema.cardReadouts.readAt,
      finishPunchedAt: schema.cardReadouts.finishPunchedAt,
      serverResult: schema.deviceIngestOutcomes.serverResult
    }).from(schema.cardReadouts)
      .innerJoin(schema.deviceIngestOutcomes, eq(schema.deviceIngestOutcomes.rawMessageId, schema.cardReadouts.rawMessageId))
      .where(eq(schema.cardReadouts.raceId, input.raceId))
      .orderBy(desc(schema.cardReadouts.readAt), desc(schema.cardReadouts.id)).limit(10_001);
    if (readoutRows.length > 10_000) throw new Error("För många okända avläsningar");
    const assignments = await tx.select({ id: schema.cardAssignments.id, entryId: schema.cardAssignments.entryId,
      cardNumber: schema.cardAssignments.cardNumber }).from(schema.cardAssignments)
      .where(and(eq(schema.cardAssignments.raceId, input.raceId), eq(schema.cardAssignments.active, true)))
      .orderBy(asc(schema.cardAssignments.entryId), asc(schema.cardAssignments.id)).limit(20_001);
    if (assignments.length > 20_000) throw new Error("För många aktiva brickkopplingar");
    const entries = await tx.select({ id: schema.entries.id, givenName: schema.entries.givenName,
      familyName: schema.entries.familyName, organisationName: schema.entries.organisationName,
      classId: schema.entries.classId, entryVersion: schema.entries.version }).from(schema.entries)
      .where(eq(schema.entries.raceId, input.raceId))
      .orderBy(asc(schema.entries.familyName), asc(schema.entries.givenName), asc(schema.entries.id)).limit(10_001);
    if (entries.length > 10_000) throw new Error("För många deltagare");
    const revisions = entries.length === 0 ? [] : await tx.selectDistinctOn([schema.resultRevisions.entryId], {
      id: schema.resultRevisions.id, entryId: schema.resultRevisions.entryId, revision: schema.resultRevisions.revision
    }).from(schema.resultRevisions).where(and(eq(schema.resultRevisions.raceId, input.raceId),
      inArray(schema.resultRevisions.entryId, entries.map((row) => row.id))))
      .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision));
    const classes = await tx.select({ id: schema.classes.id, name: schema.classes.name,
      courseVersionId: schema.classes.courseVersionId, maxEntries: schema.classes.maxEntries,
      entryCount: count(schema.entries.id) }).from(schema.classes)
      .leftJoin(schema.entries, and(eq(schema.entries.classId, schema.classes.id), eq(schema.entries.raceId, input.raceId)))
      .where(eq(schema.classes.raceId, input.raceId)).groupBy(schema.classes.id)
      .orderBy(asc(schema.classes.name), asc(schema.classes.id)).limit(1_001);
    if (classes.length > 1_000) throw new Error("För många klasser");
    const byEntry = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      const rows = byEntry.get(assignment.entryId) ?? [];
      rows.push(assignment); byEntry.set(assignment.entryId, rows);
    }
    const revisionByEntry = new Map(revisions.map((row) => [row.entryId, row]));
    return { status: "ok", response: unknownReadoutResolutionCandidateResponseSchema.parse({
      formatVersion: 1, raceId: input.raceId, snapshotVersion: race.snapshotVersion,
      engineVersion: RESULT_ENGINE_VERSION,
      readouts: readoutRows.filter((row) => isUnknownOutcome(row.serverResult) && !resolvedIds.has(row.id))
        .map((row) => ({
          id: row.id, cardNumber: row.cardNumber,
          readAt: row.readAt.toISOString(), finishPunchedAt: row.finishPunchedAt?.toISOString() ?? null
        })),
      classes,
      entries: entries.map((entry) => {
        const active = byEntry.get(entry.id) ?? [];
        const revision = revisionByEntry.get(entry.id);
        return { ...entry, activeAssignment: active.length === 1 ? { id: active[0]!.id, cardNumber: active[0]!.cardNumber } : null,
          latestResultRevision: revision ? { id: revision.id, revision: revision.revision } : null };
      })
    }) };
  });
}

export type UnknownReadoutResolutionResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" }
  | { status: "resolved"; response: UnknownReadoutResolutionResponse };

export async function resolveUnknownReadoutAsAdministrator(
  db: Database,
  input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()
): Promise<UnknownReadoutResolutionResult> {
  const key = unknownReadoutResolutionIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const parsed = unknownReadoutResolutionRequestSchema.safeParse(input.request);
  if (!key.success || !parsed.success) return { status: "invalid-request" };
  const intent = parsed.data;
  const requestId = key.data.slice("unknown-readout-resolution:".length);
  if (intent.requestId !== requestId) return { status: "invalid-request" };
  const resolvedAt = new Date(now);
  if (!Number.isFinite(resolvedAt.getTime())) throw new Error("Resolutionstiden är ogiltig");
  const authentication = { ...input, capability, requireCsrf: true };
  const preflight = await authenticatePairingAdminSession(db, authentication, resolvedAt);
  if (preflight.status !== "authenticated") return preflight;

  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, resolvedAt);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, input.raceId);
    const [journalBeforeRequestLock] = await tx.select({ entryId: schema.unknownReadoutResolutions.entryId })
      .from(schema.unknownReadoutResolutions).where(eq(schema.unknownReadoutResolutions.requestId, requestId));
    let lockedEntry: typeof schema.entries.$inferSelect | undefined;
    const targetEntryId = journalBeforeRequestLock?.entryId ??
      (intent.target === "EXISTING_ENTRY" ? intent.entryId : undefined);
    if (targetEntryId) {
      [lockedEntry] = await tx.select().from(schema.entries).where(and(eq(schema.entries.id, targetEntryId),
        eq(schema.entries.raceId, input.raceId))).for("update");
      if (!lockedEntry) return { status: "not-found" };
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.unknownReadoutResolutions)
      .where(eq(schema.unknownReadoutResolutions.requestId, requestId));
    if (existing) {
      if (existing.raceId !== input.raceId || existing.actorCredentialId !== auth.principal.accessCredentialId ||
        JSON.stringify(unknownReadoutResolutionRequestSchema.parse(existing.request)) !== JSON.stringify(intent)) {
        return { status: "conflict" };
      }
      return { status: "resolved", response: unknownReadoutResolutionResponseSchema.parse({ ...existing.response, replayed: true }) };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= 2_147_483_647 ||
      intent.expectedEngineVersion !== RESULT_ENGINE_VERSION) return { status: "conflict" };
    const [readout] = await tx.select({ readout: schema.cardReadouts, outcome: schema.deviceIngestOutcomes.serverResult })
      .from(schema.cardReadouts)
      .innerJoin(schema.deviceIngestOutcomes, eq(schema.deviceIngestOutcomes.rawMessageId, schema.cardReadouts.rawMessageId))
      .where(and(eq(schema.cardReadouts.id, intent.readoutId), eq(schema.cardReadouts.raceId, input.raceId)));
    if (!readout || readout.readout.cardNumber !== intent.cardNumber || !isUnknownOutcome(readout.outcome)) {
      return { status: "conflict" };
    }
    const [alreadyResolved] = await tx.select({ requestId: schema.unknownReadoutResolutions.requestId })
      .from(schema.unknownReadoutResolutions).where(eq(schema.unknownReadoutResolutions.readoutId, intent.readoutId));
    if (alreadyResolved) return { status: "conflict" };
    const [cardOwner] = await tx.select().from(schema.cardAssignments).where(and(
      eq(schema.cardAssignments.raceId, input.raceId), eq(schema.cardAssignments.cardNumber, intent.cardNumber)));
    if (cardOwner?.active) return { status: "conflict" };

    let entry: typeof schema.entries.$inferSelect;
    let targetClassId: string;
    let previousAssignment: typeof schema.cardAssignments.$inferSelect | undefined;
    if (intent.target === "EXISTING_ENTRY") {
      entry = lockedEntry!;
      if (entry.version !== intent.expectedEntryVersion || entry.classId !== intent.expectedClassId ||
        entry.version >= 2_147_483_647 || (cardOwner && cardOwner.entryId !== entry.id)) return { status: "conflict" };
      const active = await tx.select().from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, input.raceId),
        eq(schema.cardAssignments.entryId, entry.id), eq(schema.cardAssignments.active, true))).orderBy(asc(schema.cardAssignments.id)).limit(2);
      if (active.length > 1 || (active[0]?.id ?? null) !== (intent.expectedAssignment?.id ?? null) ||
        (active[0]?.cardNumber ?? null) !== (intent.expectedAssignment?.cardNumber ?? null)) return { status: "conflict" };
      const [latest] = await tx.select({ id: schema.resultRevisions.id, revision: schema.resultRevisions.revision })
        .from(schema.resultRevisions).where(and(eq(schema.resultRevisions.raceId, input.raceId),
          eq(schema.resultRevisions.entryId, entry.id))).orderBy(desc(schema.resultRevisions.revision)).limit(1);
      if ((latest?.id ?? null) !== (intent.expectedLatestResultRevision?.id ?? null) ||
        (latest?.revision ?? null) !== (intent.expectedLatestResultRevision?.revision ?? null)) return { status: "conflict" };
      previousAssignment = active[0];
      targetClassId = entry.classId;
    } else {
      const [raceClass] = await tx.select({ id: schema.classes.id, courseVersionId: schema.classes.courseVersionId })
        .from(schema.classes).where(and(eq(schema.classes.id, intent.classId), eq(schema.classes.raceId, input.raceId)));
      if (!raceClass || raceClass.courseVersionId !== intent.expectedCourseVersionId || cardOwner ||
        !await canAddClassEntry(tx, input.raceId, intent.classId)) return { status: "conflict" };
      const [total] = await tx.select({ value: count() }).from(schema.entries).where(eq(schema.entries.raceId, input.raceId));
      if (!total || total.value >= 10_000) return { status: "conflict" };
      const [created] = await tx.insert(schema.entries).values({ raceId: input.raceId, classId: intent.classId,
        givenName: intent.givenName, familyName: intent.familyName, organisationName: intent.organisationName,
        version: 1 }).returning();
      if (!created) throw new Error("Deltagaren kunde inte sparas");
      entry = created; targetClassId = intent.classId;
    }

    if (previousAssignment) await tx.update(schema.cardAssignments).set({ active: false })
      .where(eq(schema.cardAssignments.id, previousAssignment.id));
    let assignmentId: string;
    if (cardOwner) {
      await tx.update(schema.cardAssignments).set({ active: true }).where(eq(schema.cardAssignments.id, cardOwner.id));
      assignmentId = cardOwner.id;
    } else {
      const [created] = await tx.insert(schema.cardAssignments).values({ raceId: input.raceId,
        entryId: entry.id, cardNumber: intent.cardNumber }).returning({ id: schema.cardAssignments.id });
      if (!created) throw new Error("Brickkopplingen kunde inte sparas");
      assignmentId = created.id;
    }
    const entryVersionAfter = intent.target === "EXISTING_ENTRY" ? entry.version + 1 : 1;
    if (intent.target === "EXISTING_ENTRY") await tx.update(schema.entries).set({ version: entryVersionAfter })
      .where(and(eq(schema.entries.id, entry.id), eq(schema.entries.version, entry.version)));
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, input.raceId));
    let snapshot = await loadRaceSnapshot(tx, input.raceId);
    const normalized: NormalizedCardReadout = { id: readout.readout.id, raceId: input.raceId,
      cardNumber: readout.readout.cardNumber,
      ...(readout.readout.startPunchedAt ? { startPunchedAt: readout.readout.startPunchedAt.toISOString() } : {}),
      ...(readout.readout.finishPunchedAt ? { finishPunchedAt: readout.readout.finishPunchedAt.toISOString() } : {}), punches: readout.readout.punches,
      rawMessageId: readout.readout.rawMessageId, readAt: readout.readout.readAt.toISOString() };
    // Direktanmäld i en gafflad klass har redan sprungit: den får varianten som stämplingarna passar.
    const detected = intent.target === "EXISTING_ENTRY" ? undefined : courseVariantForReadout(normalized, snapshot);
    if (detected && !detected.assigned) {
      await tx.update(schema.entries).set({ courseVariantCode: detected.code }).where(and(eq(schema.entries.id, entry.id),
        eq(schema.entries.raceId, input.raceId)));
      snapshot = withProposedEntryVariants(snapshot, new Map([[entry.id, detected.code]]));
    }
    const evaluation = evaluateCardReadout(normalized, snapshot);
    const controlNeutralizationId = appliedControlNeutralization(snapshot, evaluation);
    if (evaluation.entryId !== entry.id || !evaluation.courseVersionId || evaluation.status === "UNKNOWN_CARD") {
      throw new Error("Den valda avläsningen kunde inte bedömas mot deltagaren");
    }
    const [latest] = await tx.select({ revision: schema.resultRevisions.revision }).from(schema.resultRevisions)
      .where(and(eq(schema.resultRevisions.raceId, input.raceId), eq(schema.resultRevisions.entryId, entry.id)))
      .orderBy(desc(schema.resultRevisions.revision)).limit(1);
    const revision = (latest?.revision ?? 0) + 1;
    const [result] = await tx.insert(schema.resultRevisions).values({ raceId: input.raceId, entryId: entry.id,
      readoutId: readout.readout.id, revision, cause: "UNKNOWN_READOUT_RESOLUTION", status: evaluation.status,
      reason: evaluation.reason, evaluation, engineVersion: RESULT_ENGINE_VERSION, controlNeutralizationId,
      snapshotVersion: snapshotVersionAfter, courseVersionId: evaluation.courseVersionId, published: true,
      createdAt: resolvedAt }).returning();
    if (!result) throw new Error("Resultatrevisionen kunde inte sparas");
    const teamId = await relayTeamOfEntry(tx, entry.id);
    if (teamId) await synchronizeRelayTeams(tx, input.raceId, [teamId], snapshotVersionAfter);
    const response = unknownReadoutResolutionResponseSchema.parse({ formatVersion: 1, replayed: false,
      requestId, raceId: input.raceId, readoutId: readout.readout.id, cardNumber: intent.cardNumber,
      target: intent.target, entryId: entry.id, entryVersion: entryVersionAfter, classId: targetClassId,
      assignmentId, resultRevisionId: result.id, revision, cause: "UNKNOWN_READOUT_RESOLUTION",
      status: evaluation.status, reason: evaluation.reason, engineVersion: RESULT_ENGINE_VERSION,
      snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter,
      courseVersionId: evaluation.courseVersionId, resolvedAt: resolvedAt.toISOString() });
    await tx.insert(schema.unknownReadoutResolutions).values({ requestId, raceId: input.raceId,
      readoutId: readout.readout.id, rawMessageId: readout.readout.rawMessageId, cardNumber: intent.cardNumber,
      actorCredentialId: auth.principal.accessCredentialId, capability, target: intent.target,
      entryId: entry.id, classId: targetClassId, assignmentId, createdResultRevisionId: result.id,
      createdResultRevision: revision, expectedSnapshotVersion: race.snapshotVersion, snapshotVersionAfter,
      request: intent, response, resolvedAt });
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "card_readout",
      entityId: readout.readout.id, action: "UNKNOWN_READOUT_RESOLVED_BY_ADMIN",
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, requestId,
      before: { serverResult: "UNKNOWN_CARD", snapshotVersion: race.snapshotVersion },
      after: { entryId: entry.id, classId: targetClassId, assignmentId, resultRevisionId: result.id,
        revision, cause: result.cause, snapshotVersion: snapshotVersionAfter } });
    return { status: "resolved", response };
  });
}

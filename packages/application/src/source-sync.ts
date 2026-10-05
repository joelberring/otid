import { createHash } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  sourceSyncStatusSchema, syncApplyIdempotencyKeySchema, syncApplyRequestSchema, syncApplyResponseSchema, syncConsequenceRequestSchema,
  syncConsequenceResponseSchema, syncPreviewResponseSchema, type SourceKind, type SourceSyncStatus, type SyncApplyResponse,
  type SyncConsequence, type SyncConsequenceResponse, type SyncPreviewResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { IofValidationError, parseIofXml } from "@o-tid/iof-xml";
import { diffCourseFile } from "./course-file-diff";
import { diffEventor } from "./eventor-sync-diff";
import { clientForLink, upstreamOutcome, type EventorRuntime } from "./eventor-link";
import {
  authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation, authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { applyCourseFile, applyEventor, assessCourseFile, assessEventor, SourceSyncConflictError } from "./source-sync-apply";
import type { CourseFileAction, CurrentState, EventorAction, EventorProjection, PlannedRow, SourceDiff, SourceProjection } from "./source-sync-model";
import { loadCurrentState, readOutByClass } from "./source-sync-state";

/**
 * Läsa in igen med skillnader (ADR-0170 beslut 4, PLAN.md steg 14): "Uppdatera från Eventor"
 * och "Läs in ny banfil" läser källan, sparar den som en ögonblicksbild och visar vad som är
 * nytt, ändrat och struket. Administratören kan bocka ur rader. Ändringar som påverkar resultat
 * ger samma besked och omräkning som "Redigera bana". Samma request-id ger samma kvitto.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" | "too-large" };
const capability = "MANAGE_RACE" as const;
const MAX_VERSION = 2_147_483_647;

export type EventorSyncPreviewResult = Failure
  | { status: "eventor"; outcome: "NOT_CONFIGURED" | "NO_KEY" | "KEY_UNREADABLE" | "NO_EVENT" | "REJECTED" | "UNAVAILABLE" | "NOT_FOUND" }
  | { status: "ok"; response: SyncPreviewResponse };

type Snapshot = typeof schema.sourceSnapshots.$inferSelect;
type AnyDiff = SourceDiff<EventorAction> | SourceDiff<CourseFileAction>;

function diffFor(projection: SourceProjection, state: CurrentState): AnyDiff {
  return projection.kind === "EVENTOR" ? diffEventor(projection, state) : diffCourseFile(projection, state, readOutByClass(state));
}

/** De rader som ska göras: allt som går att göra utom de som bockats ur. Obligatoriska rader kan inte bockas ur. */
function selection<A extends { type: string }>(diff: SourceDiff<A>, excluded: readonly string[]): PlannedRow<A>[] | undefined {
  const skip = new Set(excluded);
  const byId = new Map(diff.rows.map(planned => [planned.row.id, planned]));
  if ([...skip].some(id => !byId.get(id)?.row.optional || byId.get(id)?.action.type === "NONE")) return undefined;
  return diff.rows.filter(planned => planned.action.type !== "NONE" && !skip.has(planned.row.id));
}

async function assess(tx: Transaction, raceId: string, projection: SourceProjection, state: CurrentState, rows: PlannedRow<EventorAction | CourseFileAction>[]) {
  return projection.kind === "EVENTOR" ? assessEventor(tx, raceId, rows as PlannedRow<EventorAction>[], state)
    : assessCourseFile(tx, raceId, rows as PlannedRow<CourseFileAction>[], state);
}

function summary(diff: AnyDiff): SyncPreviewResponse["summary"] {
  const rows = diff.rows.map(planned => planned.row);
  return { new: rows.filter(row => row.kind === "NEW").length, changed: rows.filter(row => row.kind === "CHANGED").length,
    withdrawn: rows.filter(row => row.kind === "WITHDRAWN").length, conflicts: rows.filter(row => row.kind === "CONFLICT").length,
    unchanged: diff.unchanged };
}

/** Sparar källan som ny ögonblicksbild (äldre ej godkända läsningar av samma källa tas bort) och visar skillnaderna. */
async function preview(db: Database, input: Authentication, source: SourceKind, projection: SourceProjection, extra: { originalXml: string | null;
  fileName: string | null; sourceName: string }, now: Date): Promise<Failure | { status: "ok"; response: SyncPreviewResponse }> {
  const contentHash = createHash("sha256").update(JSON.stringify(projection)).digest("hex");
  try {
    return await db.transaction(async tx => {
      const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
      if (auth.status !== "authenticated") return auth;
      const race = await lockRaceForSnapshot(tx, input.raceId);
      await tx.delete(schema.sourceSnapshots).where(and(eq(schema.sourceSnapshots.raceId, input.raceId), eq(schema.sourceSnapshots.source, source),
        isNull(schema.sourceSnapshots.appliedAt)));
      const [saved] = await tx.insert(schema.sourceSnapshots).values({ raceId: input.raceId, source, contentHash,
        projection: projection as unknown as Record<string, unknown>, originalXml: extra.originalXml, fileName: extra.fileName, fetchedAt: now })
        .returning({ id: schema.sourceSnapshots.id });
      const state = await loadCurrentState(tx, input.raceId);
      const diff = diffFor(projection, state);
      const assessment = await assess(tx, input.raceId, projection, state, selection(diff as SourceDiff<EventorAction>, [])!);
      return { status: "ok" as const, response: syncPreviewResponseSchema.parse({ formatVersion: 1, raceId: input.raceId, source,
        snapshotId: saved!.id, snapshotVersion: race.snapshotVersion, fetchedAt: now.toISOString(), sourceName: extra.sourceName,
        rows: diff.rows.map(planned => planned.row), summary: summary(diff), consequence: assessment.consequence }) };
    });
  } catch (error) {
    if (error instanceof SourceSyncConflictError) return { status: error.message === "too-large" ? "too-large" : "conflict" };
    throw error;
  }
}

/** "Hämta från Eventor" / "Uppdatera från Eventor": klasser och anmälningar för den valda tävlingen. */
export async function previewEventorSyncAsAdministrator(db: Database, input: Authentication, runtime: EventorRuntime, now = new Date())
  : Promise<EventorSyncPreviewResult> {
  const auth = await authenticatePairingAdminSession(db, { ...input, capability, requireCsrf: true }, now);
  if (auth.status !== "authenticated") return auth;
  const [link] = await db.select().from(schema.raceEventorLinks).where(eq(schema.raceEventorLinks.raceId, input.raceId));
  const client = clientForLink(link, input.raceId, runtime);
  if (client.outcome !== "OK") return { status: "eventor", outcome: client.outcome };
  if (!link?.eventId || !link.eventName || !link.eventDate || !link.eventForm) return { status: "eventor", outcome: "NO_EVENT" };
  let fetched;
  try { fetched = await client.client.classesAndEntries(link.eventId); }
  catch (error) { return { status: "eventor", outcome: upstreamOutcome(error) }; }
  let event;
  try { event = await client.client.event(link.eventId); }
  catch (error) { return { status: "eventor", outcome: upstreamOutcome(error) }; }
  const projection: EventorProjection = { kind: "EVENTOR",
    event: { id: event.id, name: event.name, date: event.date, clock: event.clock ?? null, form: event.form },
    classes: fetched.classes.map(row => ({ id: row.id, name: row.name, cancelled: row.cancelled })),
    entries: fetched.entries.entries.map(entry => ({ id: entry.id, classId: entry.classId, givenName: entry.givenName,
      familyName: entry.familyName, club: entry.club?.name ?? null, cardNumber: entry.cardNumber ?? null })),
    teams: fetched.entries.teams.map(team => ({ id: team.id, classId: team.classId, name: team.name, club: team.club?.name ?? null,
      runners: team.runners.map(runner => ({ leg: runner.leg, givenName: runner.givenName ?? null, familyName: runner.familyName ?? null,
        club: runner.club?.name ?? null, cardNumber: runner.cardNumber ?? null })) })) };
  return preview(db, input, "EVENTOR", projection, { originalXml: null, fileName: null, sourceName: event.name }, now);
}

/** "Läs in banfil" / "Läs in ny banfil": IOF XML CourseData (OCAD, Purple Pen, Condes). */
export async function previewCourseFileAsAdministrator(db: Database, input: Authentication & { xml: string; fileName: string },
  now = new Date()): Promise<Failure | { status: "invalid-iof-xml" } | { status: "ok"; response: SyncPreviewResponse }> {
  const auth = await authenticatePairingAdminSession(db, { ...input, capability, requireCsrf: true }, now);
  if (auth.status !== "authenticated") return auth;
  let parsed;
  try { parsed = parseIofXml(input.xml); }
  catch (error) { if (error instanceof IofValidationError) return { status: "invalid-iof-xml" }; throw error; }
  if (parsed.kind !== "CourseData") return { status: "invalid-iof-xml" };
  const data = { courses: parsed.courses, assignments: parsed.assignments, personAssignments: parsed.personAssignments,
    teamAssignments: parsed.teamAssignments, warnings: parsed.warnings };
  const fileName = input.fileName.trim().slice(0, 260) || "banfil.xml";
  return preview(db, input, "COURSE_FILE", { kind: "COURSE_FILE", data }, { originalXml: input.xml, fileName, sourceName: fileName }, now);
}

async function loadSnapshot(tx: Transaction, raceId: string, snapshotId: string): Promise<Snapshot | undefined> {
  const [snapshot] = await tx.select().from(schema.sourceSnapshots)
    .where(and(eq(schema.sourceSnapshots.id, snapshotId), eq(schema.sourceSnapshots.raceId, raceId)));
  return snapshot;
}

/** Beskedet för ett annat urval (när rader bockats ur). Läser bara. */
export async function syncConsequenceAsAdministrator(db: Database, input: Authentication & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; response: SyncConsequenceResponse }> {
  const parsed = syncConsequenceRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  try {
    return await db.transaction(async tx => {
      const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
      if (auth.status !== "authenticated") return auth;
      const race = await lockRaceForSnapshot(tx, input.raceId);
      const snapshot = await loadSnapshot(tx, input.raceId, parsed.data.snapshotId);
      if (!snapshot) return { status: "not-found" as const };
      if (snapshot.appliedAt || race.snapshotVersion !== parsed.data.expectedSnapshotVersion) return { status: "conflict" as const };
      const projection = snapshot.projection as unknown as SourceProjection;
      const state = await loadCurrentState(tx, input.raceId);
      const rows = selection(diffFor(projection, state) as SourceDiff<EventorAction>, parsed.data.excludedRowIds);
      if (!rows) return { status: "invalid-request" as const };
      const assessment = await assess(tx, input.raceId, projection, state, rows);
      return { status: "ok" as const, response: syncConsequenceResponseSchema.parse({ formatVersion: 1, raceId: input.raceId,
        snapshotId: snapshot.id, snapshotVersion: race.snapshotVersion, consequence: assessment.consequence }) };
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof SourceSyncConflictError) return { status: error.message === "too-large" ? "too-large" : "conflict" };
    throw error;
  }
}

export type SyncApplyResult = Failure
  | { status: "confirmation-required"; consequence: SyncConsequence }
  | { status: "saved"; response: SyncApplyResponse };

/** Godkänner skillnaderna: sparar de valda raderna och räknar om berörda resultat i samma transaktion. */
export async function applySyncAsAdministrator(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<SyncApplyResult> {
  const parsed = syncApplyRequestSchema.safeParse(input.request);
  const key = syncApplyIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `source-sync:${parsed.data.requestId}`) return { status: "invalid-request" };
  const intent = parsed.data;
  const authentication = { ...input, capability, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  try {
    return await db.transaction(async (tx): Promise<SyncApplyResult> => {
      const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
      if (auth.status !== "authenticated") return auth;
      const race = await lockRaceForMutation(tx, input.raceId);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"source-sync:" + intent.requestId}, 0))`);
      const [prior] = await tx.select().from(schema.sourceSnapshots).where(eq(schema.sourceSnapshots.appliedRequestId, intent.requestId));
      if (prior) {
        const response = syncApplyResponseSchema.parse(prior.applyResponse);
        if (prior.raceId !== input.raceId || prior.actorCredentialId !== auth.principal.accessCredentialId ||
            JSON.stringify(response.request) !== JSON.stringify(intent)) return { status: "conflict" };
        return { status: "saved", response: { ...response, replayed: true } };
      }
      const snapshot = await loadSnapshot(tx, input.raceId, intent.snapshotId);
      if (!snapshot) return { status: "not-found" };
      if (snapshot.appliedAt || race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= MAX_VERSION) {
        return { status: "conflict" };
      }
      const projection = snapshot.projection as unknown as SourceProjection;
      const state = await loadCurrentState(tx, input.raceId);
      const diff = diffFor(projection, state);
      const rows = selection(diff as SourceDiff<EventorAction>, intent.excludedRowIds);
      if (!rows) return { status: "invalid-request" };
      const assessment = await assess(tx, input.raceId, projection, state, rows);
      if (assessment.consequence.requiresConfirmation && !intent.confirmResultChanges) {
        return { status: "confirmation-required", consequence: assessment.consequence };
      }
      const applyInput = { raceId: input.raceId, actorCredentialId: auth.principal.accessCredentialId,
        snapshotVersionAfter: race.snapshotVersion + 1, now, state };
      const recalculatedCount = projection.kind === "EVENTOR"
        ? await applyEventor(tx, applyInput, projection, rows, diff.links, assessment)
        : await applyCourseFile(tx, applyInput, projection, rows as unknown as PlannedRow<CourseFileAction>[], diff.links, assessment);
      const response = syncApplyResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId: input.raceId,
        source: snapshot.source, snapshotId: snapshot.id, request: intent, appliedRows: rows.length, recalculatedCount,
        snapshotVersionAfter: applyInput.snapshotVersionAfter, appliedAt: now.toISOString() });
      await tx.update(schema.sourceSnapshots).set({ appliedRequestId: intent.requestId, appliedAt: now,
        actorCredentialId: auth.principal.accessCredentialId, applyRequest: intent as unknown as Record<string, unknown>,
        applyResponse: response as unknown as Record<string, unknown> }).where(eq(schema.sourceSnapshots.id, snapshot.id));
      await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "source_snapshot", entityId: snapshot.id,
        action: snapshot.source === "EVENTOR" ? "EVENTOR_SYNC_APPLIED_BY_ADMIN" : "COURSE_FILE_APPLIED_BY_ADMIN",
        actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, requestId: intent.requestId,
        before: { snapshotVersion: race.snapshotVersion },
        after: { snapshotVersion: applyInput.snapshotVersionAfter, appliedRows: rows.length, excludedRows: intent.excludedRowIds.length,
          recalculatedCount }, createdAt: now });
      return { status: "saved", response };
    });
  } catch (error) {
    if (error instanceof SourceSyncConflictError) return { status: error.message === "too-large" ? "too-large" : "conflict" };
    throw error;
  }
}

/** När banfilen senast lästes in (visas i Banor). */
export async function getSourceSyncStatusAsAdministrator(db: Database, input: Authentication, now = new Date())
  : Promise<Failure | { status: "ok"; response: SourceSyncStatus }> {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const [latest] = await tx.select({ fileName: schema.sourceSnapshots.fileName, appliedAt: schema.sourceSnapshots.appliedAt })
      .from(schema.sourceSnapshots).where(and(eq(schema.sourceSnapshots.raceId, input.raceId), eq(schema.sourceSnapshots.source, "COURSE_FILE"),
        isNotNull(schema.sourceSnapshots.appliedAt))).orderBy(desc(schema.sourceSnapshots.appliedAt)).limit(1);
    return { status: "ok" as const, response: sourceSyncStatusSchema.parse({ formatVersion: 1, raceId: input.raceId,
      courseFile: latest ? { fileName: latest.fileName, appliedAt: latest.appliedAt!.toISOString() } : null }) };
  });
}

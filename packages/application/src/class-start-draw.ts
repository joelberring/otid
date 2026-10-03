import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  canonicalJsonBytes, classStartDrawClassesResponseSchema, classStartDrawPreviewRequestSchema,
  classStartDrawPreviewResponseSchema, classStartDrawRequestSchema, classStartDrawResponseSchema,
  type ClassStartDrawClassesResponse, type ClassStartDrawPreviewResponse, type ClassStartDrawResponse
} from "@o-tid/contracts";
import { CLASS_START_DRAW_ALGORITHM_VERSION, ClassStartDrawError, planClassStartDraw } from "@o-tid/domain";
import { schema, type Database } from "@o-tid/database";
import {
  authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import type { DbExecutor } from "./snapshot";

type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "DRAW_CLASS_START_TIMES" as const;
const MAX_CLASSES = 1_000;
const MAX_ENTRIES = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const requestPrefix = "class-start-draw:";
const iso = (value: Date | null) => value?.toISOString() ?? null;

type Result<T> = { status: "ok"; response: T } | { status: "unauthorized" | "forbidden" | "not-found" };
export type ClassStartDrawClassesResult = Result<ClassStartDrawClassesResponse>;
export type ClassStartDrawPreviewResult = Result<ClassStartDrawPreviewResponse> | { status: "invalid-request" | "conflict" };
export type ClassStartDrawCommitResult = { status: "changed"; response: ClassStartDrawResponse } | { status: "invalid-request" | "conflict" | "unauthorized" | "forbidden" | "not-found" };

function nonzeroSeed(): number {
  let seed = 0;
  while (seed === 0) seed = randomBytes(4).readUInt32BE(0);
  return seed;
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

function normalizedParameters(parameters: { algorithmVersion: string; seed: number; firstStartTime: string; intervalSeconds: number }) {
  return { ...parameters, firstStartTime: new Date(parameters.firstStartTime).toISOString() };
}

function sourceHash(input: {
  raceId: string; classId: string; className: string; snapshotVersion: number; timeZone: string;
  parameters: ReturnType<typeof normalizedParameters>; entries: readonly { id: string; version: number; givenName: string; familyName: string; fixedStartTime: Date | null }[];
}) {
  return hash({
    algorithmVersion: input.parameters.algorithmVersion, class: { id: input.classId, name: input.className },
    entries: [...input.entries].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((entry) => ({
      id: entry.id, version: entry.version, displayName: `${entry.givenName} ${entry.familyName}`,
      previousFixedStartTime: iso(entry.fixedStartTime)
    })),
    parameters: input.parameters, raceId: input.raceId, snapshotVersion: input.snapshotVersion, timeZone: input.timeZone
  });
}

async function classAndRoster(tx: DbExecutor, raceId: string, classId: string, lock: "share" | "update" = "share") {
  const [raceClass] = await tx.select({ id: schema.classes.id, name: schema.classes.name, startRule: schema.classes.startRule })
    .from(schema.classes).where(and(eq(schema.classes.id, classId), eq(schema.classes.raceId, raceId))).for(lock);
  if (!raceClass) return { status: "not-found" as const };
  if (raceClass.startRule !== "FIXED") return { status: "conflict" as const };
  const entries = await tx.select({ id: schema.entries.id, raceId: schema.entries.raceId, version: schema.entries.version, givenName: schema.entries.givenName,
    familyName: schema.entries.familyName, fixedStartTime: schema.entries.fixedStartTime })
    .from(schema.entries).where(eq(schema.entries.classId, classId))
    .orderBy(asc(schema.entries.id)).limit(MAX_ENTRIES + 1).for(lock);
  if (entries.length === 0 || entries.length > MAX_ENTRIES || entries.some((entry) => entry.raceId !== raceId)) return { status: "conflict" as const };
  return { status: "ok" as const, raceClass, entries: entries.map(entry => ({ id: entry.id, version: entry.version,
    givenName: entry.givenName, familyName: entry.familyName, fixedStartTime: entry.fixedStartTime })) };
}

function previewResponse(input: {
  raceId: string; classId: string; className: string; snapshotVersion: number; timeZone: string;
  parameters: ReturnType<typeof normalizedParameters>; sourceHash: string;
  entries: readonly { id: string; version: number; givenName: string; familyName: string; fixedStartTime: Date | null }[];
}) {
  const plan = planClassStartDraw({ algorithmVersion: CLASS_START_DRAW_ALGORITHM_VERSION, seed: input.parameters.seed,
    entryIds: input.entries.map((entry) => entry.id), firstStartTimeMs: Date.parse(input.parameters.firstStartTime), intervalSeconds: input.parameters.intervalSeconds });
  const entriesById = new Map(input.entries.map((entry) => [entry.id, entry]));
  return classStartDrawPreviewResponseSchema.parse({ formatVersion: 1, raceId: input.raceId, classId: input.classId,
    className: input.className, snapshotVersion: input.snapshotVersion, timeZone: input.timeZone,
    parameters: input.parameters, sourceHash: input.sourceHash,
    entries: plan.map((slot) => {
      const entry = entriesById.get(slot.entryId);
      if (!entry) throw new Error("Startlottningens roster är inkonsekvent");
      const fixedStartTime = new Date(slot.startTimeMs).toISOString();
      const previousFixedStartTime = iso(entry.fixedStartTime);
      return { entryId: entry.id, entryVersion: entry.version, displayName: `${entry.givenName} ${entry.familyName}`,
        previousFixedStartTime, fixedStartTime, changed: previousFixedStartTime !== fixedStartTime };
    }) });
}

export async function listClassStartDrawClassesAsAdmin(db: Database, input: Authentication, now = new Date()): Promise<ClassStartDrawClassesResult> {
  return db.transaction(async (tx) => {
    const authorized = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (authorized.status !== "authenticated") return authorized;
    const race = await lockRaceForSnapshot(tx, input.raceId);
    const [raceEvent] = await tx.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, input.raceId));
    const [event] = raceEvent ? await tx.select({ timeZone: schema.events.timeZone }).from(schema.events).where(eq(schema.events.id, raceEvent.eventId)) : [];
    if (!event) return { status: "not-found" };
    const classes = await tx.select({ id: schema.classes.id, name: schema.classes.name,
      entryCount: sql<number>`count(${schema.entries.id})::int`,
      corruptEntryCount: sql<number>`count(${schema.entries.id}) filter (where ${schema.entries.raceId} is distinct from ${schema.classes.raceId})::int` })
      .from(schema.classes).leftJoin(schema.entries, eq(schema.entries.classId, schema.classes.id))
      .where(and(eq(schema.classes.raceId, input.raceId), eq(schema.classes.startRule, "FIXED")))
      .groupBy(schema.classes.id).orderBy(asc(schema.classes.name), asc(schema.classes.id)).limit(MAX_CLASSES + 1);
    if (classes.length > MAX_CLASSES || classes.some((item) => item.entryCount > MAX_ENTRIES || item.corruptEntryCount !== 0)) throw new Error("Startlottningens underlag överskrider säker gräns");
    return { status: "ok", response: classStartDrawClassesResponseSchema.parse({ formatVersion: 1, raceId: input.raceId,
      snapshotVersion: race.snapshotVersion, timeZone: event.timeZone, seed: nonzeroSeed(), classes: classes.map(item => ({ id: item.id, name: item.name, entryCount: item.entryCount })) }) };
  });
}

export async function previewClassStartDrawAsAdmin(db: Database, input: Authentication & { request: unknown }, now = new Date()): Promise<ClassStartDrawPreviewResult> {
  const parsed = classStartDrawPreviewRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const parameters = normalizedParameters(parsed.data.parameters);
  const authentication = { ...input, capability, requireCsrf: true };
  const authorized = await authenticatePairingAdminSession(db, authentication, now);
  if (authorized.status !== "authenticated") return authorized;
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (authorization.status !== "authenticated") return authorization;
    const race = await lockRaceForSnapshot(tx, input.raceId);
    const [raceEvent] = await tx.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, input.raceId));
    const [event] = raceEvent ? await tx.select({ timeZone: schema.events.timeZone }).from(schema.events).where(eq(schema.events.id, raceEvent.eventId)) : [];
    if (!event) return { status: "not-found" };
    const roster = await classAndRoster(tx, input.raceId, parsed.data.classId);
    if (roster.status !== "ok") return roster;
    const digest = sourceHash({ raceId: input.raceId, classId: roster.raceClass.id, className: roster.raceClass.name,
      snapshotVersion: race.snapshotVersion, timeZone: event.timeZone, parameters, entries: roster.entries });
    try {
      return { status: "ok", response: previewResponse({ raceId: input.raceId, classId: roster.raceClass.id, className: roster.raceClass.name,
        snapshotVersion: race.snapshotVersion, timeZone: event.timeZone, parameters, sourceHash: digest, entries: roster.entries }) };
    } catch (error) {
      if (error instanceof ClassStartDrawError) return { status: "invalid-request" };
      throw error;
    }
  });
}

function response(row: typeof schema.classStartDrawRequests.$inferSelect, replayed: boolean) {
  return classStartDrawResponseSchema.parse({ formatVersion: 1, raceId: row.raceId, requestId: row.requestId, replayed,
    classId: row.classId, sourceHash: row.sourceHash, parameters: { algorithmVersion: row.algorithmVersion,
      seed: row.seed, firstStartTime: row.firstStartTime.toISOString(), intervalSeconds: row.intervalSeconds },
    entryCount: row.entryCount, changedEntryCount: row.changedEntryCount, snapshotVersionBefore: row.snapshotVersionBefore,
    snapshotVersionAfter: row.snapshotVersionAfter, changedAt: row.changedAt.toISOString() });
}

export async function commitClassStartDrawAsAdmin(db: Database, input: Authentication & { request: unknown; idempotencyKey: string | null }, now = new Date()): Promise<ClassStartDrawCommitResult> {
  const parsed = classStartDrawRequestSchema.safeParse(input.request);
  const requestId = input.idempotencyKey?.startsWith(requestPrefix) ? input.idempotencyKey.slice(requestPrefix.length) : "";
  if (!parsed.success || !UUID.test(requestId)) return { status: "invalid-request" };
  const intent = { ...parsed.data, parameters: normalizedParameters(parsed.data.parameters) };
  const authentication = { ...input, capability, requireCsrf: true };
  const authorized = await authenticatePairingAdminSession(db, authentication, now);
  if (authorized.status !== "authenticated") return authorized;
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (authorization.status !== "authenticated") return authorization;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.classStartDrawRequests).where(eq(schema.classStartDrawRequests.requestId, requestId));
    if (existing) {
      const existingIntent = { formatVersion: 1, classId: existing.classId, parameters: { algorithmVersion: existing.algorithmVersion,
        seed: existing.seed, firstStartTime: existing.firstStartTime.toISOString(), intervalSeconds: existing.intervalSeconds },
        expectedSnapshotVersion: existing.snapshotVersionBefore, sourceHash: existing.sourceHash };
      if (existing.actorCredentialId !== authorization.principal.accessCredentialId || existing.raceId !== input.raceId ||
        !Buffer.from(canonicalJsonBytes(existingIntent)).equals(Buffer.from(canonicalJsonBytes(intent)))) return { status: "conflict" };
      return { status: "changed", response: response(existing, true) };
    }
    const [raceEvent] = await tx.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, input.raceId));
    const [event] = raceEvent ? await tx.select({ timeZone: schema.events.timeZone }).from(schema.events).where(eq(schema.events.id, raceEvent.eventId)) : [];
    if (!event) return { status: "not-found" };
    const roster = await classAndRoster(tx, input.raceId, intent.classId, "update");
    if (roster.status !== "ok") return roster;
    const digest = sourceHash({ raceId: input.raceId, classId: roster.raceClass.id, className: roster.raceClass.name,
      snapshotVersion: race.snapshotVersion, timeZone: event.timeZone, parameters: intent.parameters, entries: roster.entries });
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || digest !== intent.sourceHash ||
      race.snapshotVersion >= 2_147_483_647) return { status: "conflict" };
    let preview: ClassStartDrawPreviewResponse;
    try {
      preview = previewResponse({ raceId: input.raceId, classId: roster.raceClass.id, className: roster.raceClass.name,
        snapshotVersion: race.snapshotVersion, timeZone: event.timeZone, parameters: intent.parameters, sourceHash: digest, entries: roster.entries });
    } catch (error) {
      if (error instanceof ClassStartDrawError) return { status: "invalid-request" };
      throw error;
    }
    const byId = new Map(roster.entries.map((entry) => [entry.id, entry]));
    const changed = preview.entries.filter((item) => item.changed);
    if (changed.length === 0 || changed.some((item) => byId.get(item.entryId)?.version === 2_147_483_647)) return { status: "conflict" };
    for (const item of changed) {
      const entry = byId.get(item.entryId);
      if (!entry) throw new Error("Startlottningens roster är inkonsekvent");
      await tx.update(schema.entries).set({ fixedStartTime: new Date(item.fixedStartTime), version: entry.version + 1 })
        .where(and(eq(schema.entries.id, entry.id), eq(schema.entries.version, entry.version)));
    }
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, input.raceId));
    const [saved] = await tx.insert(schema.classStartDrawRequests).values({ requestId, raceId: input.raceId, classId: intent.classId,
      actorCredentialId: authorization.principal.accessCredentialId, sourceHash: digest, timeZone: event.timeZone, algorithmVersion: intent.parameters.algorithmVersion,
      seed: intent.parameters.seed, firstStartTime: new Date(intent.parameters.firstStartTime), intervalSeconds: intent.parameters.intervalSeconds,
      entryCount: preview.entries.length, changedEntryCount: changed.length, snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter, changedAt: now }).returning();
    if (!saved) throw new Error("Startlottningsjournalen kunde inte sparas");
    const items = preview.entries.map((item) => ({ drawRequestId: saved.id, entryId: item.entryId,
      displayName: item.displayName, previousFixedStartTime: item.previousFixedStartTime === null ? null : new Date(item.previousFixedStartTime),
      fixedStartTime: new Date(item.fixedStartTime), entryVersionBefore: item.entryVersion, entryVersionAfter: item.entryVersion + (item.changed ? 1 : 0) }));
    for (let offset = 0; offset < items.length; offset += 1_000) await tx.insert(schema.classStartDrawItems).values(items.slice(offset, offset + 1_000));
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "class", entityId: intent.classId,
      action: "CLASS_START_DRAW_COMMITTED", actorKind: authorization.principal.capability === "MANAGE_RACE" ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "CLASS_START_DRAW_ACCESS_CREDENTIAL", actorId: authorization.principal.accessCredentialId,
      requestId, before: { snapshotVersion: race.snapshotVersion, sourceHash: digest }, after: { snapshotVersion: snapshotVersionAfter, changedEntryCount: changed.length, requestId } });
    return { status: "changed", response: response(saved, false) };
  });
}

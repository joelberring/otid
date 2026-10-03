import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import {
  entryStartTimeAdminListResponseSchema, entryStartTimeChangeRequestSchema,
  entryStartTimeChangeIdempotencyKeySchema, entryStartTimeChangeResponseSchema
} from "@o-tid/contracts";
import {
  authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";

type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "CHANGE_ENTRY_START_TIME" as const;
const iso = (value: Date | null) => value?.toISOString() ?? null;

export async function listEntryStartTimesAsAdmin(db: Database, input: Authentication, now = new Date()) {
  return db.transaction(async (tx) => {
    const authorized = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (authorized.status !== "authenticated") return authorized;
    const race = await lockRaceForSnapshot(tx, input.raceId);
    const [event] = await tx.select({ timeZone: schema.events.timeZone })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(schema.races.id, input.raceId));
    if (!event) throw new Error("Tävlingens tidszon saknas");
    const entries = await tx.select({
      id: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
      classId: schema.classes.id, className: schema.classes.name,
      version: schema.entries.version, fixedStartTime: schema.entries.fixedStartTime,
      exactTime: sql<boolean>`${schema.entries.fixedStartTime} IS NULL OR date_trunc('milliseconds', ${schema.entries.fixedStartTime}) = ${schema.entries.fixedStartTime}`
    }).from(schema.entries).innerJoin(schema.classes, and(
      eq(schema.classes.id, schema.entries.classId), eq(schema.classes.raceId, input.raceId)
    )).where(and(eq(schema.entries.raceId, input.raceId), eq(schema.classes.startRule, "FIXED")))
      .orderBy(asc(schema.entries.familyName), asc(schema.entries.givenName), asc(schema.entries.id)).limit(10_001);
    if (entries.some(entry => !entry.exactTime)) throw new Error("Starttidens precision stöds inte");
    return { status: "ok" as const, response: entryStartTimeAdminListResponseSchema.parse({
      formatVersion: 1, raceId: input.raceId, snapshotVersion: race.snapshotVersion, timeZone: event.timeZone,
      entries: entries.map(entry => ({
        id: entry.id, classId: entry.classId, className: entry.className, version: entry.version,
        displayName: `${entry.givenName} ${entry.familyName}`, fixedStartTime: iso(entry.fixedStartTime)
      }))
    }) };
  });
}

function response(row: typeof schema.entryStartTimeChangeRequests.$inferSelect, replayed: boolean) {
  return entryStartTimeChangeResponseSchema.parse({
    formatVersion: 1, replayed, requestId: row.requestId, raceId: row.raceId, entryId: row.entryId,
    classId: row.classId, previousFixedStartTime: iso(row.previousFixedStartTime),
    fixedStartTime: row.fixedStartTime.toISOString(), entryVersionBefore: row.entryVersionBefore,
    entryVersionAfter: row.entryVersionAfter, snapshotVersionBefore: row.snapshotVersionBefore,
    snapshotVersionAfter: row.snapshotVersionAfter, changedAt: row.changedAt.toISOString()
  });
}

export async function changeEntryStartTimeAsAdmin(db: Database,
  input: Authentication & { entryId: string; idempotencyKey: string | null; request: unknown },
  now = new Date()
) {
  const key = entryStartTimeChangeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const parsed = entryStartTimeChangeRequestSchema.safeParse(input.request);
  if (!key.success || !parsed.success ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.entryId)) {
    return { status: "invalid-request" as const };
  }
  const intent = parsed.data;
  const requestId = key.data.slice("entry-start-time-change:".length);
  const authentication = { ...input, capability, requireCsrf: true };
  const authorized = await authenticatePairingAdminSession(db, authentication, now);
  if (authorized.status !== "authenticated") return authorized;
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (authorization.status !== "authenticated") return authorization;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select({ ...getTableColumns(schema.entryStartTimeChangeRequests),
      exactTimes: sql<boolean>`(${schema.entryStartTimeChangeRequests.previousFixedStartTime} IS NULL OR
        date_trunc('milliseconds', ${schema.entryStartTimeChangeRequests.previousFixedStartTime}) = ${schema.entryStartTimeChangeRequests.previousFixedStartTime})
        AND date_trunc('milliseconds', ${schema.entryStartTimeChangeRequests.fixedStartTime}) = ${schema.entryStartTimeChangeRequests.fixedStartTime}`
    }).from(schema.entryStartTimeChangeRequests)
      .where(eq(schema.entryStartTimeChangeRequests.requestId, requestId));
    if (existing) {
      if (!existing.exactTimes || existing.actorCredentialId !== authorization.principal.accessCredentialId ||
        existing.raceId !== input.raceId || existing.entryId !== input.entryId ||
        existing.expectedEntryVersion !== intent.expectedEntryVersion ||
        existing.classId !== intent.expectedClassId || existing.snapshotVersionBefore !== intent.expectedSnapshotVersion ||
        iso(existing.previousFixedStartTime) !== intent.expectedFixedStartTime ||
        iso(existing.fixedStartTime) !== intent.fixedStartTime) return { status: "conflict" as const };
      return { status: "changed" as const, response: response(existing, true) };
    }
    const [entry] = await tx.select({ ...getTableColumns(schema.entries),
      exactTime: sql<boolean>`${schema.entries.fixedStartTime} IS NULL OR date_trunc('milliseconds', ${schema.entries.fixedStartTime}) = ${schema.entries.fixedStartTime}`
    }).from(schema.entries).where(and(
      eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, input.raceId)
    )).for("update");
    if (!entry) return { status: "not-found" as const };
    const [raceClass] = await tx.select().from(schema.classes).where(and(
      eq(schema.classes.id, entry.classId), eq(schema.classes.raceId, input.raceId)
    ));
    if (!entry.exactTime || !raceClass || raceClass.startRule !== "FIXED" || entry.classId !== intent.expectedClassId ||
      entry.version !== intent.expectedEntryVersion || race.snapshotVersion !== intent.expectedSnapshotVersion ||
      iso(entry.fixedStartTime) !== intent.expectedFixedStartTime || intent.fixedStartTime === intent.expectedFixedStartTime ||
      entry.version >= 2_147_483_647 || race.snapshotVersion >= 2_147_483_647) return { status: "conflict" as const };

    const entryVersionAfter = entry.version + 1;
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.entries).set({ fixedStartTime: new Date(intent.fixedStartTime), version: entryVersionAfter })
      .where(and(eq(schema.entries.id, entry.id), eq(schema.entries.version, entry.version)));
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, input.raceId));
    const [saved] = await tx.insert(schema.entryStartTimeChangeRequests).values({
      requestId, raceId: input.raceId, actorCredentialId: authorization.principal.accessCredentialId,
      entryId: entry.id, expectedEntryVersion: entry.version, classId: entry.classId,
      previousFixedStartTime: entry.fixedStartTime, fixedStartTime: new Date(intent.fixedStartTime),
      entryVersionBefore: entry.version, entryVersionAfter,
      snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter, changedAt: now
    }).returning();
    if (!saved) throw new Error("Starttidsjournalen kunde inte sparas");
    await tx.insert(schema.auditEvents).values({
      raceId: input.raceId, entityType: "entry", entityId: entry.id,
      action: "ENTRY_START_TIME_CHANGED_BY_ADMIN", actorKind: authorization.principal.capability === "MANAGE_RACE"
        ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "ENTRY_START_TIME_ACCESS_CREDENTIAL",
      actorId: authorization.principal.accessCredentialId, requestId,
      before: { fixedStartTime: iso(entry.fixedStartTime), entryVersion: entry.version, snapshotVersion: race.snapshotVersion },
      after: { fixedStartTime: intent.fixedStartTime, entryVersion: entryVersionAfter, snapshotVersion: snapshotVersionAfter }
    });
    return { status: "changed" as const, response: response(saved, false) };
  });
}

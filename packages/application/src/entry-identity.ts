import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import {
  entryIdentityAdminListResponseSchema, entryIdentityChangeRequestSchema,
  entryIdentityChangeIdempotencyKeySchema, entryIdentityChangeResponseSchema,
  entryIdentityValuesSchema, type EntryIdentityValues
} from "@o-tid/contracts";
import { authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";

type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "CHANGE_ENTRY_IDENTITY" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function sameIdentity(left: EntryIdentityValues, right: EntryIdentityValues) {
  return left.givenName === right.givenName && left.familyName === right.familyName &&
    left.organisationName === right.organisationName;
}

export async function listEntryIdentitiesAsAdmin(db: Database, input: Authentication, now = new Date()) {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" as const };
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForSnapshot(tx, input.raceId);
    const entries = await tx.select({ id: schema.entries.id, classId: schema.entries.classId,
      className: schema.classes.name, version: schema.entries.version,
      identity: { givenName: schema.entries.givenName, familyName: schema.entries.familyName,
        organisationName: schema.entries.organisationName }
    }).from(schema.entries).innerJoin(schema.classes, and(eq(schema.classes.id, schema.entries.classId),
      eq(schema.classes.raceId, input.raceId))).where(eq(schema.entries.raceId, input.raceId))
      .orderBy(asc(schema.entries.familyName), asc(schema.entries.givenName), asc(schema.entries.id)).limit(10_001);
    if (entries.length > 10_000) throw new Error("För många deltagare");
    return { status: "ok" as const, response: entryIdentityAdminListResponseSchema.parse({
      formatVersion: 1, raceId: input.raceId, snapshotVersion: race.snapshotVersion, entries
    }) };
  }, { isolationLevel: "repeatable read" });
}

function response(row: typeof schema.entryIdentityChangeRequests.$inferSelect, replayed: boolean) {
  return entryIdentityChangeResponseSchema.parse({ formatVersion: 1, replayed, requestId: row.requestId,
    raceId: row.raceId, entryId: row.entryId, classId: row.classId,
    previousIdentity: row.previousIdentity, identity: row.identity,
    entryVersionBefore: row.entryVersionBefore, entryVersionAfter: row.entryVersionAfter,
    snapshotVersionBefore: row.snapshotVersionBefore, snapshotVersionAfter: row.snapshotVersionAfter,
    changedAt: row.changedAt.toISOString() });
}

export async function changeEntryIdentityAsAdmin(db: Database,
  input: Authentication & { entryId: string; idempotencyKey: string | null; request: unknown }, now = new Date()) {
  const key = entryIdentityChangeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const parsed = entryIdentityChangeRequestSchema.safeParse(input.request);
  if (!key.success || !parsed.success || !uuid.test(input.entryId) || !uuid.test(input.raceId)) {
    return { status: "invalid-request" as const };
  }
  const intent = parsed.data;
  const requestId = key.data.slice("entry-identity-change:".length);
  const authentication = { ...input, capability, requireCsrf: true };
  const preflight = await authenticatePairingAdminSession(db, authentication, now);
  if (preflight.status !== "authenticated") return preflight;
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.entryIdentityChangeRequests)
      .where(eq(schema.entryIdentityChangeRequests.requestId, requestId));
    if (existing) {
      if (existing.raceId !== input.raceId || existing.entryId !== input.entryId ||
        existing.capability !== auth.principal.capability ||
        existing.actorCredentialId !== auth.principal.accessCredentialId || existing.classId !== intent.expectedClassId ||
        existing.entryVersionBefore !== intent.expectedEntryVersion || existing.snapshotVersionBefore !== intent.expectedSnapshotVersion ||
        !sameIdentity(entryIdentityValuesSchema.parse(existing.previousIdentity), intent.expectedIdentity) ||
        !sameIdentity(entryIdentityValuesSchema.parse(existing.identity), intent.identity)) return { status: "conflict" as const };
      return { status: "changed" as const, response: response(existing, true) };
    }
    const [entry] = await tx.select().from(schema.entries).where(and(eq(schema.entries.id, input.entryId),
      eq(schema.entries.raceId, input.raceId))).for("update");
    if (!entry) return { status: "not-found" as const };
    if (entry.version !== intent.expectedEntryVersion || entry.classId !== intent.expectedClassId ||
      race.snapshotVersion !== intent.expectedSnapshotVersion || entry.version >= 2_147_483_647 ||
      race.snapshotVersion >= 2_147_483_647 || !sameIdentity(entry, intent.expectedIdentity) ||
      sameIdentity(entry, intent.identity)) return { status: "conflict" as const };
    await tx.update(schema.entries).set({ ...intent.identity, version: entry.version + 1 })
      .where(eq(schema.entries.id, entry.id));
    await tx.update(schema.races).set({ snapshotVersion: race.snapshotVersion + 1 })
      .where(eq(schema.races.id, input.raceId));
    const [saved] = await tx.insert(schema.entryIdentityChangeRequests).values({ requestId,
      raceId: input.raceId, entryId: entry.id, classId: entry.classId, capability: auth.principal.capability,
      actorCredentialId: auth.principal.accessCredentialId, previousIdentity: intent.expectedIdentity,
      identity: intent.identity, entryVersionBefore: entry.version, entryVersionAfter: entry.version + 1,
      snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter: race.snapshotVersion + 1,
      changedAt: now }).returning();
    if (!saved) throw new Error("Rättningsjournalen kunde inte sparas");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "entry", entityId: entry.id,
      action: "ENTRY_IDENTITY_CHANGED_BY_ADMIN", actorKind: auth.principal.capability === "MANAGE_RACE"
        ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "ENTRY_IDENTITY_ACCESS_CREDENTIAL",
      actorId: auth.principal.accessCredentialId, requestId,
      before: { entryVersion: entry.version, snapshotVersion: race.snapshotVersion },
      after: { entryVersion: entry.version + 1, snapshotVersion: race.snapshotVersion + 1 } });
    return { status: "changed" as const, response: response(saved, false) };
  });
}

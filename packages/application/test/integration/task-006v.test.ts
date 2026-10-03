import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, sql } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import {
  createEventorConnection, createEventorRaceImportGrant, importEventorEntriesAsAdmin, importEventorEventAsAdmin, issuePairingAdminAccessCredential, listEventorConnectionsAsAdmin,
  previewEventorImportAsAdmin, revokeEventorConnection,
  issueEventCreationAccessCredential, loginEventCreationAdmin, loginPairingAdmin, revokeEventCreationAccessCredential, revokeEventorRaceImportGrant,
  type EventorImportRuntime,
} from "../../src";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const at = new Date("2026-09-05T08:00:00Z");
const masterKey = new Uint8Array(32).fill(17);
const apiKey = "SyntheticEventorKey-1234567890ab";
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function setup() {
  const credential = await issueEventCreationAccessCredential(db, { label: "Eventor test", expiresAt: new Date("2026-09-05T16:00:00Z") }, { now: at });
  const login = await loginEventCreationAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential }, { now: at });
  if (login.status !== "authenticated") throw new Error("Login failed");
  const connection = await createEventorConnection(db, { ownerCredentialId: credential.credentialId,
    label: "Testeventor", operatorLabel: "synthetic test operator", environment: "testeventor-se",
    keyId: "test-master", apiKey, masterKey }, at);
  const auth = { sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const eventId = "event-" + randomUUID();
  const projection = { eventId, eventName: "Syntetisk tävling", startDate: "2026-09-05", races: [
    { eventRaceId: "stage-1", raceName: "Etapp ett", raceDate: "2026-09-05" },
    { eventRaceId: "stage-2", raceName: "Etapp två", raceDate: "2026-09-06" },
  ] };
  const fetchEvent = vi.fn(async () => ({ projection, sourceHash: "a".repeat(64) }));
  const runtime: EventorImportRuntime = { now: () => at, masterKeyFor: () => masterKey, fetchEvent };
  const request = { formatVersion: 1, connectionId: connection.connectionId, eventId,
    eventRaceId: "stage-2", timeZone: "Europe/Stockholm", sourceHash: "a".repeat(64) };
  const input = { ...auth, readBody: async () => request, idempotencyKey: `eventor-import:${randomUUID()}` };
  return { credential, connection, auth, projection, fetchEvent, runtime, request, input };
}

describe("TASK 006V PostgreSQL", () => {
  it("TASK101 keeps profile, AAD and external provenance separate without live Eventor traffic", async () => {
    const credential = await issueEventCreationAccessCredential(db, { label: "TASK101 profile owner",
      expiresAt: new Date("2026-09-05T16:00:00Z") }, { now: at });
    const login = await loginEventCreationAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential }, { now: at });
    if (login.status !== "authenticated") throw new Error("TASK101 login failed");
    const testConnection = await createEventorConnection(db, { ownerCredentialId: credential.credentialId,
      label: "TASK101 test", operatorLabel: "synthetic operator", environment: "testeventor-se",
      keyId: "task101-key", apiKey, masterKey }, at);
    const productionConnection = await createEventorConnection(db, { ownerCredentialId: credential.credentialId,
      label: "TASK101 production", operatorLabel: "synthetic operator", environment: "production-se",
      keyId: "task101-key", apiKey, masterKey }, at);
    const externalEventId = "task101-" + randomUUID();
    const projection = { eventId: externalEventId, eventName: "TASK101 syntetisk", startDate: "2026-09-05",
      races: [{ eventRaceId: "race", raceName: "Lång", raceDate: "2026-09-05" }] };
    const profiles: string[] = [];
    const runtime: EventorImportRuntime = { now: () => at, masterKeyFor: () => masterKey,
      fetchEvent: async (input) => { profiles.push(input.profile); return { projection, sourceHash: "f".repeat(64) }; } };
    const auth = { sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
    for (const connection of [testConnection, productionConnection]) {
      const result = await importEventorEventAsAdmin(db, { ...auth, idempotencyKey: `eventor-import:${randomUUID()}`,
        readBody: async () => ({ formatVersion: 1, connectionId: connection.connectionId, eventId: externalEventId,
          eventRaceId: "race", timeZone: "Europe/Stockholm", sourceHash: "f".repeat(64) }) }, runtime);
      expect(result).toMatchObject({ status: "created", response: { environment: connection === productionConnection ? "production-se" : "testeventor-se" } });
    }
    expect(profiles).toEqual(["testeventor-se", "production-se"]);
    const imports = await db.select({ environment: schema.eventorImportRequests.environment })
      .from(schema.eventorImportRequests).where(eq(schema.eventorImportRequests.externalEventId, externalEventId));
    expect(imports.map((row) => row.environment).sort()).toEqual(["production-se", "testeventor-se"]);
  });

  it("TASK098 binds an immutable grant to exact Eventor provenance and its intended IMPORT_IOF credential", async () => {
    const f = await setup();
    const created = await importEventorEventAsAdmin(db, f.input, f.runtime);
    if (created.status !== "created") throw new Error("Eventorimporten misslyckades");
    const recipient = await issuePairingAdminAccessCredential(db, {
      raceId: created.response.raceId, capability: "IMPORT_IOF", label: "Anmälningsimport",
      expiresAt: new Date("2026-09-05T15:00:00Z")
    }, { now: at });
    const [provenance] = await db.select().from(schema.eventorImportRequests)
      .where(eq(schema.eventorImportRequests.requestId, created.response.requestId));
    if (!provenance) throw new Error("Proveniens saknas");
    const grant = await createEventorRaceImportGrant(db, {
      eventorImportRequestId: provenance.requestId, ownerCredentialId: f.credential.credentialId,
      recipientCredentialId: recipient.credentialId, label: "Lång anmälda", operatorLabel: "syntetisk operatör"
    }, at);
    expect(grant.raceId).toBe(created.response.raceId);
    const [storedGrant] = await db.select().from(schema.eventorRaceImportGrants)
      .where(eq(schema.eventorRaceImportGrants.id, grant.grantId));
    expect(storedGrant).toMatchObject({ eventorImportRequestId: provenance.requestId,
      recipientCredentialId: recipient.credentialId, issuerCredentialId: f.credential.credentialId,
      capability: "IMPORT_IOF" });
    await expect(db.update(schema.eventorRaceImportGrants).set({ label: "ändrad" })
      .where(eq(schema.eventorRaceImportGrants.id, grant.grantId))).rejects.toThrow();
    await expect(createEventorRaceImportGrant(db, { eventorImportRequestId: provenance.requestId,
      ownerCredentialId: randomUUID(), recipientCredentialId: recipient.credentialId,
      label: "fel", operatorLabel: "syntetisk operatör" }, at)).rejects.toThrow("INVALID_OWNER");
    expect(await revokeEventorRaceImportGrant(db, { grantId: grant.grantId,
      ownerCredentialId: f.credential.credentialId, operatorLabel: "syntetisk operatör", reason: "test" }, at))
      .toEqual({ status: "revoked" });
    expect(await revokeEventorRaceImportGrant(db, { grantId: grant.grantId,
      ownerCredentialId: f.credential.credentialId, operatorLabel: "syntetisk operatör", reason: "test" }, at))
      .toEqual({ status: "already-revoked" });
    await expect(db.delete(schema.eventorRaceImportGrantRevocations)
      .where(eq(schema.eventorRaceImportGrantRevocations.grantId, grant.grantId))).rejects.toThrow();
  });

  it("TASK098 atomically creates only new Eventor entries, conflicts on a changed source, and replays after grant revoke", async () => {
    const f = await setup();
    const importedRace = await importEventorEventAsAdmin(db, f.input, f.runtime);
    if (importedRace.status !== "created") throw new Error("Eventorimporten misslyckades");
    const courseId = randomUUID(), courseVersionId = randomUUID(), classA = randomUUID(), classB = randomUUID();
    await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Synthetic Eventor course')", [courseId, importedRace.response.raceId]);
    await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
    await pool.query("INSERT INTO class(id,race_id,name,course_version_id) VALUES($1,$2,'D21 synthetic',$3),($4,$2,'H21 synthetic',$3)",
      [classA, importedRace.response.raceId, courseVersionId, classB]);
    const recipient = await issuePairingAdminAccessCredential(db, { raceId: importedRace.response.raceId,
      capability: "IMPORT_IOF", label: "Anmälningsimport", expiresAt: new Date("2026-09-05T15:00:00Z") }, { now: at });
    const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: recipient.accessCredential }, {
      expectedRaceId: importedRace.response.raceId, expectedCapability: "IMPORT_IOF", now: at
    });
    if (login.status !== "authenticated") throw new Error("Importinloggningen misslyckades");
    const [provenance] = await db.select().from(schema.eventorImportRequests)
      .where(eq(schema.eventorImportRequests.requestId, importedRace.response.requestId));
    if (!provenance) throw new Error("Proveniens saknas");
    const grant = await createEventorRaceImportGrant(db, { eventorImportRequestId: provenance.requestId,
      ownerCredentialId: f.credential.credentialId, recipientCredentialId: recipient.credentialId,
      label: "Lång anmälda", operatorLabel: "syntetisk operatör" }, at);
    const source = { projection: { classes: [{ externalId: "D21", name: "D21" }, { externalId: "H21", name: "H21" }],
      entries: [{ externalId: "entry-d21", externalClassId: "D21", givenName: "Ada", familyName: "Synthetic", organisationName: "IF Test" },
        { externalId: "entry-h21", externalClassId: "H21", givenName: "Bo", familyName: "Synthetic" }] },
      eventClassesSourceHash: "c".repeat(64), entriesSourceHash: "d".repeat(64) };
    const request = { formatVersion: 1 as const, grantId: grant.grantId,
      eventClassesSourceHash: source.eventClassesSourceHash, entriesSourceHash: source.entriesSourceHash,
      mappings: [{ externalClassId: "H21", classId: classB }, { externalClassId: "D21", classId: classA }] };
    const input = { raceId: importedRace.response.raceId, sessionToken: login.sessionToken,
      csrfCookie: login.csrfToken, csrfHeader: login.csrfToken,
      idempotencyKey: `eventor-entry-import:${randomUUID()}`, readBody: async () => request };
    const fetchEntryImport = vi.fn(async () => source);
    const created = await importEventorEntriesAsAdmin(db, input, { ...f.runtime, fetchEntryImport });
    expect(created).toMatchObject({ status: "created", response: { replayed: false, entriesSeen: 2,
      entriesCreated: 2, entriesUnchanged: 0, snapshotVersionBefore: 1, snapshotVersionAfter: 2 } });
    const entries = await db.select().from(schema.entries).where(eq(schema.entries.raceId, importedRace.response.raceId));
    expect(entries.map((entry) => ({ source: entry.externalSource, externalId: entry.externalId, classId: entry.classId }))
      .sort((left, right) => String(left.externalId).localeCompare(String(right.externalId))))
      .toEqual([{ source: "eventor", externalId: "entry-d21", classId: classA },
        { source: "eventor", externalId: "entry-h21", classId: classB }]);
    expect(await importEventorEntriesAsAdmin(db, { ...input, idempotencyKey: `eventor-entry-import:${randomUUID()}` }, {
      ...f.runtime, fetchEntryImport: vi.fn(async () => { throw new Error("must not fetch duplicate intent"); })
    })).toEqual({ status: "conflict" });
    const changed = { ...source, projection: { ...source.projection, entries: [
      { ...source.projection.entries[0]!, givenName: "Changed" }, source.projection.entries[1]!
    ] }, entriesSourceHash: "e".repeat(64) };
    expect(await importEventorEntriesAsAdmin(db, { ...input, idempotencyKey: `eventor-entry-import:${randomUUID()}`,
      readBody: async () => ({ ...request, entriesSourceHash: changed.entriesSourceHash }) }, {
      ...f.runtime, fetchEntryImport: async () => changed
    })).toEqual({ status: "conflict" });
    expect(await revokeEventorRaceImportGrant(db, { grantId: grant.grantId, ownerCredentialId: f.credential.credentialId,
      operatorLabel: "syntetisk operatör", reason: "test" }, at)).toEqual({ status: "revoked" });
    const unavailable = vi.fn(async () => { throw new Error("A receipt must not refetch"); });
    expect(await importEventorEntriesAsAdmin(db, input, { ...f.runtime, masterKeyFor: () => undefined,
      fetchEntryImport: unavailable })).toEqual({ status: "created", response: {
      ...(created.status === "created" ? created.response : (() => { throw new Error(); })()), replayed: true
    } });
    expect(unavailable).not.toHaveBeenCalled();
    expect(await db.select().from(schema.eventorEntryImportRequests)
      .where(eq(schema.eventorEntryImportRequests.raceId, importedRace.response.raceId))).toHaveLength(1);
  });

  it("previews privately without writes, then atomically imports the explicitly selected race", async () => {
    const f = await setup();
    const before = await db.select().from(schema.events);
    const list = await listEventorConnectionsAsAdmin(db, f.auth, at);
    expect(list).toEqual({ status: "available", response: { formatVersion: 1, connections: [
      { connectionId: f.connection.connectionId, label: "Testeventor", environment: "testeventor-se" },
    ] } });
    const preview = await previewEventorImportAsAdmin(db, { ...f.auth, readBody: async () => ({
      formatVersion: 1, connectionId: f.connection.connectionId, eventId: f.request.eventId,
    }) }, f.runtime);
    expect(preview).toMatchObject({ status: "available", response: { projection: f.projection, sourceHash: f.request.sourceHash } });
    expect(JSON.stringify(preview)).not.toContain(apiKey);
    expect(await db.select().from(schema.events)).toEqual(before);
    const result = await importEventorEventAsAdmin(db, f.input, f.runtime);
    expect(result).toMatchObject({ status: "created", response: { replayed: false, externalEventRaceId: "stage-2" } });
    if (result.status !== "created") throw new Error();
    const [event] = await db.select().from(schema.events).where(eq(schema.events.id, result.response.eventId));
    const races = await db.select().from(schema.races).where(eq(schema.races.eventId, result.response.eventId));
    expect(event).toMatchObject({ name: "Syntetisk tävling", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
    expect(races).toHaveLength(1);
    expect(races[0]).toMatchObject({ name: "Etapp två", raceDate: "2026-09-06", snapshotVersion: 1 });
    const [journal] = await db.select().from(schema.eventorImportRequests).where(eq(schema.eventorImportRequests.requestId, result.response.requestId));
    expect(journal).toMatchObject({ actorCredentialId: f.credential.credentialId, mappingVersion: 1, externalEventId: f.request.eventId });
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, result.response.requestId))).toHaveLength(1);
    expect(await db.select().from(schema.entries).where(eq(schema.entries.raceId, result.response.raceId))).toHaveLength(0);
    expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, result.response.raceId))).toHaveLength(0);
    expect(await db.select().from(schema.pairingAdminAccessCredentials).where(eq(schema.pairingAdminAccessCredentials.raceId, result.response.raceId))).toHaveLength(0);
    const [stored] = await db.select().from(schema.eventorConnections).where(eq(schema.eventorConnections.id, f.connection.connectionId));
    expect(JSON.stringify(stored)).not.toContain(apiKey);
    await expect(db.update(schema.eventorConnections).set({ label: "changed" }).where(eq(schema.eventorConnections.id, f.connection.connectionId))).rejects.toThrow();
    await expect(db.update(schema.eventorImportRequests).set({ sourceHash: "b".repeat(64) }).where(eq(schema.eventorImportRequests.requestId, result.response.requestId))).rejects.toThrow();
  });

  it("replays without network/masterkey, conflicts on changed intent, and deduplicates across owners", async () => {
    const f = await setup();
    const created = await importEventorEventAsAdmin(db, f.input, f.runtime);
    if (created.status !== "created") throw new Error();
    const unreachable = vi.fn(async () => { throw new Error("DO_NOT_EXPOSE"); });
    const master = vi.fn(() => undefined);
    const retry = await importEventorEventAsAdmin(db, f.input, { ...f.runtime, fetchEvent: unreachable, masterKeyFor: master });
    expect(retry).toEqual({ status: "created", response: { ...created.response, replayed: true } });
    expect(unreachable).not.toHaveBeenCalled(); expect(master).not.toHaveBeenCalled();
    for (const change of [{ sourceHash: "b".repeat(64) }, { eventRaceId: "stage-1" }, { timeZone: "UTC" }]) {
      expect(await importEventorEventAsAdmin(db, { ...f.input, readBody: async () => ({ ...f.request, ...change }) }, f.runtime)).toEqual({ status: "conflict" });
    }
    const other = await setup();
    const otherRequest = { ...f.request, connectionId: other.connection.connectionId };
    const otherRuntime = { ...other.runtime, fetchEvent: f.fetchEvent };
    expect(await importEventorEventAsAdmin(db, { ...other.input, idempotencyKey: f.input.idempotencyKey, readBody: async () => otherRequest }, otherRuntime)).toEqual({ status: "conflict" });
    expect(await importEventorEventAsAdmin(db, { ...other.input, readBody: async () => otherRequest }, otherRuntime)).toEqual({ status: "conflict" });
    expect(await db.select().from(schema.eventorImportRequests).where(eq(schema.eventorImportRequests.externalEventId, f.request.eventId))).toHaveLength(1);
  });

  it("serializes concurrent imports of one external event across separate connections/owners", async () => {
    const a = await setup(), b = await setup();
    const outcomes = await Promise.all([
      importEventorEventAsAdmin(db, a.input, a.runtime),
      importEventorEventAsAdmin(db, { ...b.input, readBody: async () => ({ ...a.request, connectionId: b.connection.connectionId }) }, { ...b.runtime, fetchEvent: a.fetchEvent }),
    ]);
    expect(outcomes.filter((r) => r.status === "created")).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === "conflict")).toHaveLength(1);
    expect(await db.select().from(schema.eventorImportRequests).where(eq(schema.eventorImportRequests.externalEventId, a.request.eventId))).toHaveLength(1);
  });

  it("checks auth before body/network and rejects source changes, no race and corrupt projection without writes", async () => {
    const f = await setup(), other = await setup();
    const readBody = vi.fn(async () => f.request);
    expect(await importEventorEventAsAdmin(db, { ...f.input, sessionToken: null, readBody }, f.runtime)).toEqual({ status: "unauthorized" });
    expect(readBody).not.toHaveBeenCalled(); expect(f.fetchEvent).not.toHaveBeenCalled();
    expect(await importEventorEventAsAdmin(db, { ...f.input, csrfHeader: null }, f.runtime)).toEqual({ status: "forbidden" });
    expect(await importEventorEventAsAdmin(db, { ...f.input, ...other.auth }, f.runtime)).toEqual({ status: "forbidden" });
    expect(f.fetchEvent).not.toHaveBeenCalled();
    const before = await db.select().from(schema.events);
    expect(await importEventorEventAsAdmin(db, f.input, { ...f.runtime, fetchEvent: async () => ({ projection: f.projection, sourceHash: "b".repeat(64) }) })).toEqual({ status: "conflict" });
    expect(await importEventorEventAsAdmin(db, f.input, { ...f.runtime, fetchEvent: async () => ({ projection: { ...f.projection, races: [] }, sourceHash: f.request.sourceHash }) })).toEqual({ status: "invalid-request" });
    expect(await importEventorEventAsAdmin(db, f.input, { ...f.runtime, fetchEvent: async () => ({ projection: { ...f.projection, startDate: "2026-02-30" }, sourceHash: f.request.sourceHash }) })).toEqual({ status: "source-unavailable" });
    expect(await importEventorEventAsAdmin(db, f.input, { ...f.runtime, masterKeyFor: () => new Uint8Array(32).fill(99) })).toEqual({ status: "source-unavailable" });
    expect(await db.select().from(schema.events)).toEqual(before);
  });

  it("rechecks revocation and session expiry after network without holding locks over the fetch", async () => {
    const f = await setup();
    const duringFetch: EventorImportRuntime = { ...f.runtime, fetchEvent: async () => {
      expect(await revokeEventorConnection(db, { connectionId: f.connection.connectionId, operatorLabel: "test" }, at)).toEqual({ status: "revoked" });
      return { projection: f.projection, sourceHash: f.request.sourceHash };
    } };
    expect(await importEventorEventAsAdmin(db, f.input, duringFetch)).toEqual({ status: "forbidden" });
    expect(await revokeEventorConnection(db, { connectionId: f.connection.connectionId, operatorLabel: "test" }, at)).toEqual({ status: "already-revoked" });
    await expect(db.update(schema.eventorConnectionRevocations).set({ operatorLabel: "changed" }).where(eq(schema.eventorConnectionRevocations.connectionId, f.connection.connectionId))).rejects.toThrow();
    const expired = await setup(); let time = at;
    expect(await importEventorEventAsAdmin(db, expired.input, { ...expired.runtime, now: () => time, fetchEvent: async () => {
      time = new Date("2026-09-05T09:00:00Z"); return { projection: expired.projection, sourceHash: expired.request.sourceHash };
    } })).toEqual({ status: "unauthorized" });
    const revokedOwner = await setup();
    expect(await previewEventorImportAsAdmin(db, { ...revokedOwner.auth, readBody: async () => ({ formatVersion: 1,
      connectionId: revokedOwner.connection.connectionId, eventId: revokedOwner.request.eventId }) }, {
      ...revokedOwner.runtime, fetchEvent: async () => {
        await revokeEventCreationAccessCredential(db, { credentialId: revokedOwner.credential.credentialId }, at);
        return { projection: revokedOwner.projection, sourceHash: revokedOwner.request.sourceHash };
      },
    })).toEqual({ status: "unauthorized" });
    for (const fixture of [f, expired, revokedOwner]) {
      expect(await db.select().from(schema.eventorImportRequests).where(eq(schema.eventorImportRequests.externalEventId, fixture.request.eventId))).toHaveLength(0);
    }
  });

  it("rolls back event/race/reference when the final audit insert fails", async () => {
    const f = await setup();
    const marker = "rollback-" + randomUUID();
    const before = await db.select().from(schema.events);
    await db.execute(sql`CREATE FUNCTION otid_test_006v_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'EVENT_IMPORTED_FROM_TESTEVENTOR' AND NEW.after->>'eventName' LIKE 'rollback-%'
      THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER otid_test_006v_fail_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION otid_test_006v_fail_audit()`);
    try {
      await expect(importEventorEventAsAdmin(db, f.input, { ...f.runtime, fetchEvent: async () => ({
        projection: { ...f.projection, eventName: marker }, sourceHash: f.request.sourceHash,
      }) })).rejects.toThrow();
      expect(await db.select().from(schema.events)).toEqual(before);
      expect(await db.select().from(schema.eventorImportRequests).where(eq(schema.eventorImportRequests.externalEventId, f.request.eventId))).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER otid_test_006v_fail_audit ON audit_event`);
      await db.execute(sql`DROP FUNCTION otid_test_006v_fail_audit()`);
    }
  });
});

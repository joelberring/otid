import { randomUUID, createHash } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { migrate } from "@o-tid/database";
import { eq, sql } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { canonicalStartCheckinOperation, canonicalStartCheckinConflictReviewSource, type StartCheckinOperation } from "@o-tid/contracts";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { registerStartCheckinDeviceAsAdmin } from "../../src/start-checkin-device";
import { syncStartCheckinAsAdmin, storeAuthorizedStartCheckinOperation } from "../../src/start-checkin-sync";
import { listStartCheckinRosterAsAdmin } from "../../src/start-checkin-roster";
import { readStartCheckinConflictReviewAsAdmin, reviewStartCheckinConflictsAsAdmin } from "../../src/checkin-conflict-review";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url), at = new Date("2026-09-05T10:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function admin(raceId: string, capability: "START_CHECKIN" | "FINISH_FOREST_WATCH") {
  const issued = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic review", expiresAt: new Date("2026-09-05T18:00:00.000Z") }, { now: at });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, { expectedRaceId: raceId, expectedCapability: capability, now: at });
  if (login.status !== "authenticated") throw new Error("Synthetic auth failed");
  const auth = { raceId, capability, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const deviceId = randomUUID();
  await registerStartCheckinDeviceAsAdmin(db, { ...auth, readBody: async () => ({ formatVersion: 1, deviceId, label: "Synthetic mobile" }) }, () => at);
  return { auth, deviceId, actorCredentialId: issued.credentialId };
}
const body = (operation: StartCheckinOperation) => ({ operation, contentHash: createHash("sha256").update(canonicalStartCheckinOperation(operation)).digest("hex") });
async function setup() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID(), classId = randomUUID(), entryId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Synthetic conflict review", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Synthetic", raceDate: "2026-09-05" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Synthetic" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "Fri klass", startRule: "PUNCH" });
  await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Synthetic", familyName: "Runner" });
  const start = await admin(raceId, "START_CHECKIN"), finish = await admin(raceId, "FINISH_FOREST_WATCH");
  const operation = (sequence: number): StartCheckinOperation => ({ formatVersion: 1, raceId, entryId, deviceId: start.deviceId,
    actorCredentialId: start.actorCredentialId, requestId: randomUUID(), localSequence: sequence, packageVersion: 1,
    expectedEntryVersion: 1, expectedRevision: 0, dependsOnRequestId: null, observedAt: at.toISOString(),
    action: { kind: "MARK_START", state: sequence === 1 ? "STARTED" : "REPORTED_NOT_STARTED" } });
  const send = (op: StartCheckinOperation) => syncStartCheckinAsAdmin(db, { ...start.auth, readBody: async () => body(op) }, () => at);
  await send(operation(1)); const conflicted = operation(2); await send(conflicted);
  const candidate = async () => {
    const result = await readStartCheckinConflictReviewAsAdmin(db, { ...finish.auth, entryId }, at);
    if (result.status !== "ok") throw new Error("Synthetic candidate failed");
    return result.response;
  };
  const intent = async () => {
    const current = await candidate();
    return { formatVersion: 1, requestId: randomUUID(), entryId, sourceHash: current.sourceHash,
      conflictRequestIds: current.source.conflicts.map(row => row.operation.requestId), decision: "KEEP_CURRENT_STATE", reason: "Kontrollerad uppgift" };
  };
  const review = (value: unknown) => reviewStartCheckinConflictsAsAdmin(db, { ...finish.auth, readBody: async () => value }, () => at);
  return { raceId, entryId, start, finish, operation, send, conflicted, candidate, intent, review };
}

describe("authenticated conflict review", () => {
  it("reviews exact reports without hiding a started runner or changing original history", async () => {
    const f = await setup(), intent = await f.intent();
    const originals = await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, f.raceId));
    const response = await f.review(intent);
    expect(response).toMatchObject({ status: "reviewed", response: { conflictRequestIds: [f.conflicted.requestId], decision: "KEEP_CURRENT_STATE" } });
    expect(await f.review(intent)).toEqual(response);
    const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, intent.requestId));
    expect(audits).toHaveLength(1);
    expect(createHash("sha256").update(canonicalStartCheckinConflictReviewSource(audits[0]?.after?.source)).digest("hex")).toBe(intent.sourceHash);
    const roster = await listStartCheckinRosterAsAdmin(db, f.finish.auth, at);
    if (roster.status !== "ok") throw new Error("Roster missing");
    expect(roster.response.entries[0]).not.toHaveProperty("reviewedConflictRequestIds");
    expect(await listStartCheckinRosterAsAdmin(db, { ...f.finish.auth, reviewDetails: true }, at))
      .toMatchObject({ status: "ok", response: { entries: [{ reviewedConflictRequestIds: [f.conflicted.requestId] }] } });
    expect(roster).toMatchObject({ status: "ok", response: { entries: [{ conflictingReports: false, forestState: "STARTED_NO_RETURN", needsFollowUp: true }] } });
    expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, f.raceId))).toEqual(originals);
    expect((await f.candidate()).source.conflicts).toHaveLength(0);
    expect(await f.review({ ...intent, reason: "Ändrad" })).toEqual({ status: "conflict" });
    const another = await admin(f.raceId, "FINISH_FOREST_WATCH");
    expect(await reviewStartCheckinConflictsAsAdmin(db, { ...another.auth, readBody: async () => intent }, () => at)).toEqual({ status: "conflict" });
    const late = f.operation(3); await f.send(late);
    expect(await listStartCheckinRosterAsAdmin(db, { ...f.finish.auth, reviewDetails: true }, at))
      .toMatchObject({ status: "ok", response: { entries: [{ reviewedConflictRequestIds: [f.conflicted.requestId], conflictingReports: true }] } });
    expect(await f.review(intent)).toEqual(response);
    expect((await f.candidate()).source.conflicts.map(row => row.operation.requestId)).toEqual([late.requestId]);
    expect(await listStartCheckinRosterAsAdmin(db, f.finish.auth, at)).toMatchObject({ status: "ok", response: { entries: [{ conflictingReports: true, forestState: "CONFLICT" }] } });
  });
  it("checks finish authority and CSRF before body, and read time does not change source hash", async () => {
    const f = await setup(), readBody = vi.fn(async () => f.intent());
    expect(await reviewStartCheckinConflictsAsAdmin(db, { ...f.start.auth, readBody }, () => at)).toEqual({ status: "forbidden" });
    expect((await reviewStartCheckinConflictsAsAdmin(db, { ...f.finish.auth, sessionToken: "invalid", readBody }, () => at)).status).toBe("unauthorized");
    expect((await reviewStartCheckinConflictsAsAdmin(db, { ...f.finish.auth, csrfHeader: "invalid", readBody }, () => at)).status).toBe("forbidden");
    expect(readBody).not.toHaveBeenCalled();
    expect((await readStartCheckinConflictReviewAsAdmin(db, { ...f.start.auth, entryId: f.entryId }, at)).status).toBe("forbidden");
    const later = await readStartCheckinConflictReviewAsAdmin(db, { ...f.finish.auth, entryId: f.entryId }, new Date(at.getTime() + 1000));
    expect(later).toMatchObject({ status: "ok", response: { sourceHash: (await f.candidate()).sourceHash } });
  });
  it("rejects stale state and serializes competing review intents", async () => {
    const f = await setup(), stale = await f.intent(); await f.send(f.operation(3));
    expect(await f.review(stale)).toEqual({ status: "conflict" });
    const fresh = await f.intent();
    const responses = await Promise.all([f.review(fresh), f.review({ ...fresh, requestId: randomUUID() })]);
    expect(responses.map(result => result.status).sort()).toEqual(["conflict", "reviewed"]);
    expect(await db.select().from(schema.startCheckinConflictReviews).where(eq(schema.startCheckinConflictReviews.raceId, f.raceId))).toHaveLength(1);
  });
  it("requires a new review after a finish correction changes registered return", async () => {
    const f = await setup(), stale = await f.intent();
    const correction: StartCheckinOperation = { ...f.operation(1), requestId: randomUUID(), deviceId: f.finish.deviceId,
      actorCredentialId: f.finish.actorCredentialId, expectedRevision: 1,
      action: { kind: "FINISH_CORRECTION", state: "STARTED", manualReturnRegistered: true } };
    expect(await syncStartCheckinAsAdmin(db, { ...f.finish.auth, readBody: async () => body(correction) }, () => at))
      .toMatchObject({ status: "stored", response: { effect: { kind: "APPLIED" } } });
    expect(await f.review(stale)).toEqual({ status: "conflict" });
    expect((await f.review(await f.intent())).status).toBe("reviewed");
    expect(await listStartCheckinRosterAsAdmin(db, f.finish.auth, at)).toMatchObject({ status: "ok", response: {
      entries: [{ conflictingReports: false, forestState: "RETURNED", needsFollowUp: false, manualReturnRegistered: true }]
    } });
  });
  it("rechecks after waiting for a new report under the same entry lock", async () => {
    const f = await setup(), intent = await f.intent(), late = f.operation(3);
    let release!: () => void, ready!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), locked = new Promise<void>(resolve => { ready = resolve; });
    const reporting = db.transaction(async tx => {
      await tx.select().from(schema.entries).where(eq(schema.entries.id, f.entryId)).for("update");
      await storeAuthorizedStartCheckinOperation(tx, body(late), "START_CHECKIN", at);
      ready(); await gate;
    });
    await locked; const reviewing = f.review(intent);
    try {
      await vi.waitFor(async () => {
        const waiting = await pool.query("select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%entry%for update%'");
        expect(waiting.rowCount).toBeGreaterThan(0);
      }, { timeout: 3000, interval: 10 });
    } finally { release(); }
    await reporting; expect(await reviewing).toEqual({ status: "conflict" });
    expect(await db.select().from(schema.startCheckinConflictReviews).where(eq(schema.startCheckinConflictReviews.raceId, f.raceId))).toHaveLength(0);
  });
  it("rolls back header and memberships together when audit fails", async () => {
    const f = await setup(), intent = await f.intent();
    await db.execute(sql`CREATE FUNCTION otid_review_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'START_CHECKIN_CONFLICTS_REVIEWED' THEN RAISE EXCEPTION 'Synthetic review failure'; END IF; RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER otid_review_audit_failure BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION otid_review_audit_failure()`);
    try {
      await expect(f.review(intent)).rejects.toThrow();
      expect(await db.select().from(schema.startCheckinConflictReviews).where(eq(schema.startCheckinConflictReviews.raceId, f.raceId))).toHaveLength(0);
      expect(await db.select().from(schema.startCheckinConflictReviewItems).where(eq(schema.startCheckinConflictReviewItems.raceId, f.raceId))).toHaveLength(0);
      expect((await f.candidate()).source.conflicts).toHaveLength(1);
    } finally {
      await db.execute(sql`DROP TRIGGER otid_review_audit_failure ON audit_event`);
      await db.execute(sql`DROP FUNCTION otid_review_audit_failure()`);
    }
    expect((await f.review(intent)).status).toBe("reviewed");
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, count } from "drizzle-orm";
import { migrate } from "@o-tid/database";
import { createDatabase, schema, type Database } from "@o-tid/database";
import { createEvent, issuePairingAdminAccessCredential, loginPairingAdmin, revokePairingAdminAccessCredential,
  reservePmDocumentAsAdmin, allocatePmUploadAttemptAsAdmin } from "../../src";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-07T10:00:00Z");
const request = { formatVersion: 1, title: "Synthetic PM", mediaType: "application/pdf", sha256: "a".repeat(64), byteLength: 1024 };
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function access(raceId: string, capability: "MANAGE_PM_DOCUMENT" | "VIEW_SPEAKER_BOARD" = "MANAGE_PM_DOCUMENT") {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic PM", expiresAt: new Date(now.getTime() + 8 * 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential }, { now, expectedRaceId: raceId, expectedCapability: capability });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { installation, login, input: { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken } };
}
async function fixture() {
  const { race } = await createEvent(db, { name: "Synthetic PM", raceName: "Synthetic", raceDate: "2026-09-07", timeZone: "Europe/Stockholm" });
  return { race, ...await access(race.id) };
}
const key = () => `pm-upload:${randomUUID()}`;
async function reservation(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await reservePmDocumentAsAdmin(db, { ...f.input, request, idempotencyKey: key() }, now);
  if (result.status !== "reserved") throw new Error("Synthetic reservation failed");
  return result.response.uploadId;
}
describe("TASK013 authenticated reservation and charged attempts", () => {
  it("uses separate PM credentials and one-hour sessions; refuses bad CSRF, role and expiry", async () => {
    const f = await fixture(), wrong = await access(f.race.id, "VIEW_SPEAKER_BOARD");
    expect(f.installation.accessCredential.startsWith("otid_org_pm_document_v1.")).toBe(true);
    expect(f.login.response.expiresAt).toBe("2026-09-07T11:00:00.000Z");
    const input = { ...f.input, request, idempotencyKey: key() };
    expect((await reservePmDocumentAsAdmin(db, { ...input, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await reservePmDocumentAsAdmin(db, { ...input, ...wrong.input }, now)).status).toBe("forbidden");
    expect((await reservePmDocumentAsAdmin(db, input, new Date("2026-09-07T11:00:00Z"))).status).toBe("unauthorized");
    expect((await reservePmDocumentAsAdmin(db, { ...input, sessionToken: null, request: {} }, now)).status).toBe("unauthorized");
  });
  it("returns the same reservation after lost response without duplicate audit or snapshot changes", async () => {
    const f = await fixture(), input = { ...f.input, request, idempotencyKey: key() };
    const first = await reservePmDocumentAsAdmin(db, input, now), retry = await reservePmDocumentAsAdmin(db, input, now);
    expect(first.status).toBe("reserved"); expect(retry.status).toBe("reserved");
    if (first.status !== "reserved" || retry.status !== "reserved") throw new Error("Missing reservation");
    expect(retry.response).toEqual({ ...first.response, replayed: true });
    expect((await db.select({ count: count() }).from(schema.pmUploadReservations).where(eq(schema.pmUploadReservations.raceId, f.race.id)))[0]?.count).toBe(1);
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId, first.response.uploadId));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(request.title);
    expect((await db.select().from(schema.races).where(eq(schema.races.id, f.race.id)))[0]?.snapshotVersion).toBe(f.race.snapshotVersion);
  });
  it("conflicts on changed intent, actor or race for the same request identity", async () => {
    const f = await fixture(), otherActor = await access(f.race.id), otherRace = await fixture();
    const input = { ...f.input, request, idempotencyKey: key() };
    await reservePmDocumentAsAdmin(db, input, now);
    for (const changed of [{ ...request, title: "Changed" }, { ...request, byteLength: 1025 }, { ...request, sha256: "b".repeat(64) }]) {
      expect((await reservePmDocumentAsAdmin(db, { ...input, request: changed }, now)).status).toBe("conflict");
    }
    expect((await reservePmDocumentAsAdmin(db, { ...input, ...otherActor.input }, now)).status).toBe("conflict");
    expect((await reservePmDocumentAsAdmin(db, { ...input, ...otherRace.input }, now)).status).toBe("conflict");
  });
  it("serializes concurrent exact retries and rejects revoked authority even for an old retry", async () => {
    const f = await fixture(), input = { ...f.input, request, idempotencyKey: key() };
    const results = await Promise.all([reservePmDocumentAsAdmin(db, input, now), reservePmDocumentAsAdmin(db, input, now)]);
    expect(results.map(result => result.status)).toEqual(["reserved", "reserved"]);
    const ids = results.flatMap(result => result.status === "reserved" ? [result.response.uploadId] : []);
    expect(new Set(ids).size).toBe(1);
    await revokePairingAdminAccessCredential(db, { credentialId: f.installation.credentialId, capability: "MANAGE_PM_DOCUMENT" }, now);
    expect((await reservePmDocumentAsAdmin(db, input, now)).status).toBe("unauthorized");
  });
  it("retains exact retry at full quota while rejecting a 101st reservation", async () => {
    const f = await fixture(), input = { ...f.input, request, idempotencyKey: key() };
    await reservePmDocumentAsAdmin(db, input, now);
    await pool.query(`INSERT INTO pm_upload_reservation
      (id,request_id,race_id,actor_credential_id,capability,slot,title,media_type,sha256,byte_length,reserved_at)
      SELECT gen_random_uuid(),gen_random_uuid(),$1,$2,'MANAGE_PM_DOCUMENT',slot,'Synthetic','application/pdf',$3,1024,$4
      FROM generate_series(2,100) slot`, [f.race.id, f.installation.credentialId, request.sha256, now]);
    expect((await reservePmDocumentAsAdmin(db, input, now)).status).toBe("reserved");
    expect((await reservePmDocumentAsAdmin(db, { ...input, idempotencyKey: key() }, now)).status).toBe("quota-exceeded");
  });
  it("charges concurrent attempts exactly once per allocation and never exceeds eight", async () => {
    const f = await fixture(), uploadId = await reservation(f), other = await access(f.race.id);
    expect((await allocatePmUploadAttemptAsAdmin(db, { ...other.input, uploadId }, now)).status).toBe("not-found");
    const attempts = await Promise.all(Array.from({ length: 10 }, () => allocatePmUploadAttemptAsAdmin(db, { ...f.input, uploadId }, now)));
    expect(attempts.filter(result => result.status === "allocated")).toHaveLength(8);
    expect(attempts.filter(result => result.status === "quota-exceeded")).toHaveLength(2);
    const rows = await db.select().from(schema.pmUploadAttempts).where(eq(schema.pmUploadAttempts.uploadId, uploadId));
    expect(rows.reduce((sum, row) => sum + row.byteLength, 0)).toBe(8192);
    expect(new Set(rows.map(row => row.id)).size).toBe(8);
  });
  it("returns an existing stored manifest without charging a new attempt", async () => {
    const f = await fixture(), uploadId = await reservation(f);
    const allocated = await allocatePmUploadAttemptAsAdmin(db, { ...f.input, uploadId }, now);
    if (allocated.status !== "allocated") throw new Error("Missing attempt");
    const attempt = allocated.attempt;
    await db.transaction(async tx => {
      await tx.insert(schema.pmObjectManifests).values({ uploadId, attemptId: attempt.id, raceId: f.race.id, storeId: randomUUID(),
        objectKey: `pm/${f.race.id}/${attempt.id}`, versionId: "synthetic-version", sha256: request.sha256, byteLength: request.byteLength, storedAt: now });
      await tx.insert(schema.pmScanJobs).values({ uploadId, createdAt: now });
    });
    expect((await allocatePmUploadAttemptAsAdmin(db, { ...f.input, uploadId }, now)).status).toBe("already-stored");
    expect((await db.select({ count: count() }).from(schema.pmUploadAttempts).where(eq(schema.pmUploadAttempts.uploadId, uploadId)))[0]?.count).toBe(1);
  });

  it("rolls back reservation, charge and audit on a late transaction failure", async () => {
    const f = await fixture(), idempotencyKey = key();
    await expect(db.transaction(async tx => {
      const result = await reservePmDocumentAsAdmin(tx as unknown as Database, { ...f.input, request, idempotencyKey }, now);
      expect(result.status).toBe("reserved");
      throw new Error("Synthetic late failure");
    })).rejects.toThrow("Synthetic late failure");
    expect((await db.select().from(schema.pmUploadReservations).where(eq(schema.pmUploadReservations.raceId, f.race.id)))).toHaveLength(0);
    const uploadId = await reservation(f);
    await expect(db.transaction(async tx => {
      expect((await allocatePmUploadAttemptAsAdmin(tx as unknown as Database, { ...f.input, uploadId }, now)).status).toBe("allocated");
      throw new Error("Synthetic late failure");
    })).rejects.toThrow("Synthetic late failure");
    expect((await db.select().from(schema.pmUploadAttempts).where(eq(schema.pmUploadAttempts.uploadId, uploadId)))).toHaveLength(0);
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, f.race.id));
    expect(audit.filter(row => row.action === "PM_UPLOAD_RESERVED")).toHaveLength(1);
    expect(audit.filter(row => row.action === "PM_UPLOAD_ATTEMPT_CHARGED")).toHaveLength(0);
  });

  it("rejects a credential revocation that commits while mutation authorization waits", async () => {
    const f = await fixture(), client = await pool.connect();
    let pending: ReturnType<typeof reservePmDocumentAsAdmin> | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM pairing_admin_access_credential WHERE id=$1 FOR UPDATE", [f.installation.credentialId]);
      const pid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      pending = reservePmDocumentAsAdmin(db, { ...f.input, request, idempotencyKey: key() }, now);
      let blocked = false;
      for (let n = 0; n < 100 && !blocked; n++) {
        const result = await pool.query<{ blocked: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid]);
        blocked = result.rows[0]?.blocked ?? false;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await client.query("INSERT INTO pairing_admin_access_credential_revocation (credential_id,revoked_at,reason) VALUES ($1,$2,'Synthetic concurrent revoke')", [f.installation.credentialId, now]);
      await client.query("COMMIT");
      expect((await pending).status).toBe("unauthorized");
      expect((await db.select().from(schema.pmUploadReservations).where(eq(schema.pmUploadReservations.raceId, f.race.id)))).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
      if (pending) await pending;
    }
  });
});

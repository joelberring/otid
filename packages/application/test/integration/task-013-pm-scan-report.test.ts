import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, schema } from "@o-tid/database";
import { claimPmScanJob, releasePmScanJob } from "../../src/pm-scan-jobs";
import { recordPmScanReport } from "../../src/pm-scan-report";
import { pmScanEvidenceFixture } from "../../../contracts/test/fixtures/pm-scan";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), actorId = randomUUID(), uploadId = randomUUID(), attemptId = randomUUID();
  const now = new Date(), hash = "a".repeat(64);
  await db.transaction(async tx => {
    await tx.insert(schema.events).values({ id: eventId, name: "Synthetic report", startsOn: "2026-09-08", timeZone: "Europe/Stockholm" });
    await tx.insert(schema.races).values({ id: raceId, eventId, name: "Synthetic report", raceDate: "2026-09-08" });
    await tx.insert(schema.pairingAdminAccessCredentials).values({ id: actorId, raceId, capability: "MANAGE_PM_DOCUMENT", label: "Synthetic", secretHash: hash, issuedAt: now, expiresAt: new Date(now.getTime() + 3600_000) });
    await tx.insert(schema.pmUploadReservations).values({ id: uploadId, requestId: randomUUID(), raceId, actorCredentialId: actorId, capability: "MANAGE_PM_DOCUMENT", slot: 1, title: "Synthetic PM", mediaType: "application/pdf", sha256: hash, byteLength: 346, reservedAt: now });
    await tx.insert(schema.pmUploadAttempts).values({ id: attemptId, uploadId, raceId, attemptNumber: 1, sha256: hash, byteLength: 346, chargedAt: now });
    await tx.insert(schema.pmObjectManifests).values({ uploadId, attemptId, raceId, storeId: randomUUID(), objectKey: `pm/${raceId}/${attemptId}`, versionId: "v1", sha256: hash, byteLength: 346, storedAt: now });
    await tx.insert(schema.pmScanJobs).values({ uploadId, createdAt: new Date(now.getTime() - 3600_000) });
  });
  const claimed = await claimPmScanJob(db, { uploadId, workerId: randomUUID() });
  if (claimed.status !== "claimed") throw new Error("Expected lease");
  const evidence = pmScanEvidenceFixture();
  evidence.manifest = claimed.manifest;
  evidence.startedAt = claimed.leasedAt.toISOString(); evidence.finishedAt = evidence.startedAt;
  for (const name of ["daily", "main", "bytecode"] as const) {
    evidence.clamav!.databases![name].builtAt = new Date(claimed.leasedAt.getTime() - 3600_000).toISOString();
  }
  return { ...claimed, evidence };
}
async function reports(uploadId: string) {
  return (await pool.query<{ id: string; outcome: string; publishable: boolean; content_hash: string; evidence: unknown }>(
    "SELECT * FROM pm_scan_report WHERE upload_id=$1", [uploadId])).rows;
}

describe("TASK013 immutable reports and final PostgreSQL fencing; synthetic observations only", () => {
  it("commits a report and FINISHED atomically, but never marks native evidence publishable", async () => {
    const f = await fixture(), result = await recordPmScanReport(db, f.lease, f.evidence);
    expect(result).toMatchObject({ status: "recorded", outcome: "PASSED", publishable: false, replayed: false });
    const rows = await reports(f.lease.uploadId);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ outcome: "PASSED", publishable: false, evidence: f.evidence });
    expect(rows[0]!.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect((await pool.query("SELECT state,lease_owner,lease_until FROM pm_scan_job WHERE upload_id=$1", [f.lease.uploadId])).rows)
      .toEqual([{ state: "FINISHED", lease_owner: null, lease_until: null }]);
    expect(await claimPmScanJob(db, { uploadId: f.lease.uploadId, workerId: randomUUID() })).toEqual({ status: "no-job" });
  });

  it("returns the same report for reordered exact retry, including after lease expiry", async () => {
    const f = await fixture(), first = await recordPmScanReport(db, f.lease, f.evidence);
    // Expiry is now past for a historical report; do not edit immutable attempt/report.
    await pool.query("UPDATE pm_scan_job SET state='LEASED',lease_owner=$2,lease_until=clock_timestamp()-interval '1 second' WHERE upload_id=$1", [f.lease.uploadId, f.lease.workerId]);
    const reordered = Object.fromEntries(Object.entries(f.evidence).reverse());
    const retry = await recordPmScanReport(db, f.lease, reordered);
    expect(retry).toEqual({ ...first, replayed: true });
    expect(await reports(f.lease.uploadId)).toHaveLength(1);
  });

  it("conflicts changed evidence or owner instead of rewriting a report", async () => {
    const f = await fixture(); await recordPmScanReport(db, f.lease, f.evidence);
    expect(await recordPmScanReport(db, f.lease, { ...f.evidence, cleanupSucceeded: false })).toEqual({ status: "conflict" });
    expect(await recordPmScanReport(db, { ...f.lease, workerId: randomUUID() }, f.evidence)).toEqual({ status: "conflict" });
    expect((await reports(f.lease.uploadId))[0]!.outcome).toBe("PASSED");
  });

  it("serializes concurrent exact commits into one report and one replay", async () => {
    const f = await fixture();
    const results = await Promise.all([recordPmScanReport(db, f.lease, f.evidence), recordPmScanReport(db, f.lease, f.evidence)]);
    expect(results.map(result => result.status)).toEqual(["recorded", "recorded"]);
    expect(results.filter(result => result.status === "recorded" && result.replayed)).toHaveLength(1);
    expect(await reports(f.lease.uploadId)).toHaveLength(1);
  });

  it("rejects stale generation/owner, released work and takeover without report", async () => {
    const f = await fixture();
    expect(await recordPmScanReport(db, { ...f.lease, workerId: randomUUID() }, f.evidence)).toEqual({ status: "stale-lease" });
    expect(await recordPmScanReport(db, { ...f.lease, generation: f.lease.generation + 1n }, f.evidence)).toEqual({ status: "stale-lease" });
    expect(await releasePmScanJob(db, f.lease)).toEqual({ status: "released" });
    expect(await recordPmScanReport(db, f.lease, f.evidence)).toEqual({ status: "stale-lease" });
    const next = await claimPmScanJob(db, { uploadId: f.lease.uploadId, workerId: randomUUID() });
    expect(next.status).toBe("claimed");
    expect(await recordPmScanReport(db, f.lease, f.evidence)).toEqual({ status: "stale-lease" });
    expect(await reports(f.lease.uploadId)).toHaveLength(0);
  });

  it("conflicts concurrent different observations for the same attempt", async () => {
    const f = await fixture();
    const results = await Promise.all([
      recordPmScanReport(db, f.lease, f.evidence),
      recordPmScanReport(db, f.lease, { ...f.evidence, cleanupSucceeded: false })
    ]);
    expect(results.map(result => result.status).sort()).toEqual(["conflict", "recorded"]);
    expect(await reports(f.lease.uploadId)).toHaveLength(1);
  });

  it("rejects substituted manifests and invalid scan intervals without state change", async () => {
    const f = await fixture();
    expect(await recordPmScanReport(db, f.lease, { ...f.evidence, manifest: { ...f.evidence.manifest, versionId: "another" } })).toEqual({ status: "invalid-evidence" });
    expect(await recordPmScanReport(db, f.lease, { ...f.evidence, startedAt: new Date(f.leasedAt.getTime() - 1).toISOString() })).toEqual({ status: "invalid-evidence" });
    expect(await recordPmScanReport(db, f.lease, { ...f.evidence, finishedAt: new Date(f.leaseUntil.getTime() + 1).toISOString() })).toEqual({ status: "invalid-evidence" });
    expect(await recordPmScanReport(db, f.lease, { ...f.evidence, finishedAt: new Date(f.leasedAt.getTime() + 240_000).toISOString() })).toEqual({ status: "stale-lease" });
    expect(await reports(f.lease.uploadId)).toHaveLength(0);
  });

  it("does not extend an immutable attempt when mutable job expiry is later", async () => {
    const f = await fixture();
    const old = await pool.query<{ start: Date; finish: Date }>(`INSERT INTO pm_scan_attempt
      (upload_id,generation,lease_owner,leased_at,lease_until)
      VALUES($1,2,$2,now()-interval '6 minutes',now()-interval '1 minute')
      RETURNING leased_at AS start, lease_until AS finish`, [f.lease.uploadId, f.lease.workerId]);
    await pool.query("UPDATE pm_scan_job SET generation=2,lease_until=now()+interval '1 hour' WHERE upload_id=$1", [f.lease.uploadId]);
    f.evidence.startedAt = new Date(old.rows[0]!.start.getTime() + 1).toISOString();
    f.evidence.finishedAt = new Date(old.rows[0]!.finish.getTime() - 1).toISOString();
    expect(await recordPmScanReport(db, { ...f.lease, generation: 2n }, f.evidence)).toEqual({ status: "stale-lease" });
    expect(await reports(f.lease.uploadId)).toHaveLength(0);
  });

  it("stores failed or rejected observations without inventing unavailable tools", async () => {
    const failed = await fixture(); failed.evidence.qpdf = null; failed.evidence.clamav = null;
    expect(await recordPmScanReport(db, failed.lease, failed.evidence)).toMatchObject({ status: "recorded", outcome: "FAILED", publishable: false });
    const rejected = await fixture(); rejected.evidence.qpdf!.encryption!.exitCode = 0; rejected.evidence.qpdf!.check = null; rejected.evidence.clamav = null;
    expect(await recordPmScanReport(db, rejected.lease, rejected.evidence)).toMatchObject({ status: "recorded", outcome: "REJECTED", publishable: false });
  });

  it("rolls back a newly inserted report if expiry occurs before final CAS", async () => {
    const f = await fixture(), name = `test_pm_report_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.upload_id = '${f.lease.uploadId}'::uuid THEN PERFORM pg_sleep(0.2); END IF;
      RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON pm_scan_report FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    try {
      await pool.query("UPDATE pm_scan_job SET lease_until=clock_timestamp()+interval '100 milliseconds' WHERE upload_id=$1", [f.lease.uploadId]);
      expect(await recordPmScanReport(db, f.lease, f.evidence)).toEqual({ status: "stale-lease" });
      expect(await reports(f.lease.uploadId)).toHaveLength(0);
      expect((await pool.query<{ state: string }>("SELECT state FROM pm_scan_job WHERE upload_id=$1", [f.lease.uploadId])).rows[0]!.state).toBe("LEASED");
    } finally {
      await pool.query(`DROP TRIGGER ${name} ON pm_scan_report`); await pool.query(`DROP FUNCTION ${name}()`);
    }
  });

  it("rolls back the report on final job constraint failure", async () => {
    const f = await fixture(), name = `test_pm_finish_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`ALTER TABLE pm_scan_job ADD CONSTRAINT ${name} CHECK (upload_id <> '${f.lease.uploadId}' OR state::text <> 'FINISHED')`);
    try { await expect(recordPmScanReport(db, f.lease, f.evidence)).rejects.toMatchObject({ cause: { code: "23514" } }); }
    finally { await pool.query(`ALTER TABLE pm_scan_job DROP CONSTRAINT ${name}`); }
    expect(await reports(f.lease.uploadId)).toHaveLength(0);
    expect(await recordPmScanReport(db, f.lease, f.evidence)).toMatchObject({ status: "recorded", replayed: false });
  });

  it("enforces report immutability and exact attempt-owner FK, never native publication", async () => {
    const f = await fixture(); await recordPmScanReport(db, f.lease, f.evidence);
    await expect(pool.query("UPDATE pm_scan_report SET outcome='FAILED' WHERE upload_id=$1", [f.lease.uploadId])).rejects.toMatchObject({ code: "P0001" });
    await expect(pool.query("DELETE FROM pm_scan_report WHERE upload_id=$1", [f.lease.uploadId])).rejects.toMatchObject({ code: "P0001" });
    const other = await fixture();
    const insert = (worker: string, publishable: boolean) => pool.query(`INSERT INTO pm_scan_report
      (upload_id,generation,lease_owner,outcome,publishable,evidence,content_hash) VALUES($1,$2,$3,'PASSED',$4,'{}',$5)`,
    [other.lease.uploadId, other.lease.generation.toString(), worker, publishable, "a".repeat(64)]);
    await expect(insert(randomUUID(), false)).rejects.toMatchObject({ code: "23503" });
    await expect(insert(other.lease.workerId, true)).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects caller outcome, logs or bad lease identity before persistence", async () => {
    const f = await fixture();
    for (const extra of [{ outcome: "PASSED" }, { publishable: true }, { stdout: "private" }]) {
      expect(await recordPmScanReport(db, f.lease, { ...f.evidence, ...extra })).toEqual({ status: "invalid-input" });
    }
    expect(await recordPmScanReport(db, { ...f.lease, generation: 0n }, f.evidence)).toEqual({ status: "invalid-input" });
    expect(await reports(f.lease.uploadId)).toHaveLength(0);
  });
});

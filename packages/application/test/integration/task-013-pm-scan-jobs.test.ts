import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { claimPmScanJob, releasePmScanJob } from "../../src/pm-scan-jobs";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture() {
  const client = await pool.connect();
  const eventId = randomUUID(), raceId = randomUUID(), actorId = randomUUID();
  const uploadId = randomUUID(), attemptId = randomUUID(), storeId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Synthetic scan','2026-09-08','Europe/Stockholm')", [eventId]);
    await client.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Synthetic scan','2026-09-08')", [raceId, eventId]);
    await client.query(`INSERT INTO pairing_admin_access_credential(id,race_id,capability,label,secret_hash,issued_at,expires_at)
      VALUES($1,$2,'MANAGE_PM_DOCUMENT','Synthetic',$3,now(),now()+interval '1 hour')`, [actorId, raceId, "a".repeat(64)]);
    await client.query(`INSERT INTO pm_upload_reservation(id,request_id,race_id,actor_credential_id,capability,slot,title,media_type,sha256,byte_length,reserved_at)
      VALUES($1,$2,$3,$4,'MANAGE_PM_DOCUMENT',1,'Synthetic PM','application/pdf',$5,346,now())`, [uploadId, randomUUID(), raceId, actorId, "a".repeat(64)]);
    await client.query(`INSERT INTO pm_upload_attempt(id,upload_id,race_id,attempt_number,sha256,byte_length,charged_at)
      VALUES($1,$2,$3,1,$4,346,now())`, [attemptId, uploadId, raceId, "a".repeat(64)]);
    await client.query(`INSERT INTO pm_object_manifest(upload_id,attempt_id,race_id,store_id,object_key,version_id,sha256,byte_length,stored_at)
      VALUES($1,$2,$3,$4,$5,'exact-v1',$6,346,now())`, [uploadId, attemptId, raceId, storeId, `pm/${raceId}/${attemptId}`, "a".repeat(64)]);
    await client.query("INSERT INTO pm_scan_job(upload_id,created_at) VALUES($1,now()-interval '1 hour')", [uploadId]);
    await client.query("COMMIT");
    return { uploadId, storeId, key: `pm/${raceId}/${attemptId}` };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
async function claim(uploadId: string, workerId: string = randomUUID()) {
  const result = await claimPmScanJob(db, { uploadId, workerId });
  if (result.status !== "claimed") throw new Error(`Expected claim, got ${result.status}`);
  return result;
}
async function job(uploadId: string) {
  return (await pool.query("SELECT * FROM pm_scan_job WHERE upload_id=$1", [uploadId])).rows[0] as {
    state: string; generation: string; lease_owner: string | null; lease_until: Date | null;
  };
}
async function attempts(uploadId: string) {
  return (await pool.query<{ generation: string; lease_owner: string; leased_at: Date; lease_until: Date }>(
    "SELECT * FROM pm_scan_attempt WHERE upload_id=$1 ORDER BY generation", [uploadId])).rows;
}

describe("TASK013 real PostgreSQL scan leases; no scanner/READY proof", () => {
  it("commits exact manifest, DB-clock lease and immutable attempt together", async () => {
    const f = await fixture();
    const before = (await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
    const result = await claim(f.uploadId);
    const after = (await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
    expect(result.lease.generation).toBe(1n);
    expect(result.leasedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.leasedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(result.leaseUntil.getTime() - result.leasedAt.getTime()).toBe(300_000);
    expect(result.manifest).toMatchObject({ storeId: f.storeId, key: f.key, versionId: "exact-v1", byteLength: 346 });
    expect(await job(f.uploadId)).toMatchObject({ state: "LEASED", generation: "1", lease_owner: result.lease.workerId, lease_until: result.leaseUntil });
    expect(await attempts(f.uploadId)).toMatchObject([{ generation: "1", lease_owner: result.lease.workerId, leased_at: result.leasedAt, lease_until: result.leaseUntil }]);
    await expect(pool.query("UPDATE pm_scan_attempt SET lease_owner=$2 WHERE upload_id=$1", [f.uploadId, randomUUID()])).rejects.toMatchObject({ code: "P0001" });
    await expect(pool.query("DELETE FROM pm_scan_attempt WHERE upload_id=$1", [f.uploadId])).rejects.toMatchObject({ code: "P0001" });
  });

  it("gives only one of two concurrent workers a targeted job", async () => {
    const f = await fixture();
    const results = await Promise.all([claimPmScanJob(db, { uploadId: f.uploadId, workerId: randomUUID() }), claimPmScanJob(db, { uploadId: f.uploadId, workerId: randomUUID() })]);
    expect(results.map(result => result.status).sort()).toEqual(["claimed", "no-job"]);
    expect(await attempts(f.uploadId)).toHaveLength(1);
  });

  it("skips a locked job without waiting for the other transaction", async () => {
    const f = await fixture(), blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT upload_id FROM pm_scan_job WHERE upload_id=$1 FOR UPDATE", [f.uploadId]);
      expect(await claimPmScanJob(db, { uploadId: f.uploadId, workerId: randomUUID() })).toEqual({ status: "no-job" });
      expect(await attempts(f.uploadId)).toHaveLength(0);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    expect((await claim(f.uploadId)).lease.generation).toBe(1n);
  });

  it("retains a crashed worker lease until expiry and rejects its later release", async () => {
    const f = await fixture(), first = await claim(f.uploadId);
    expect(await claimPmScanJob(db, { uploadId: f.uploadId, workerId: first.lease.workerId })).toEqual({ status: "no-job" });
    // Only synthetic test state is advanced; immutable attempt history stays untouched.
    await pool.query("UPDATE pm_scan_job SET lease_until=clock_timestamp()-interval '1 second' WHERE upload_id=$1", [f.uploadId]);
    expect(await releasePmScanJob(db, first.lease)).toEqual({ status: "stale-lease" });
    const second = await claim(f.uploadId);
    expect(second.lease.generation).toBe(2n);
    expect(await releasePmScanJob(db, first.lease)).toEqual({ status: "stale-lease" });
    expect((await job(f.uploadId)).lease_owner).toBe(second.lease.workerId);
    expect(await attempts(f.uploadId)).toHaveLength(2);
  });

  it("releases only the current worker and preserves history across a new claim", async () => {
    const f = await fixture(), first = await claim(f.uploadId);
    expect(await releasePmScanJob(db, { ...first.lease, workerId: randomUUID() })).toEqual({ status: "stale-lease" });
    expect(await releasePmScanJob(db, { ...first.lease, generation: 2n })).toEqual({ status: "stale-lease" });
    expect(await releasePmScanJob(db, first.lease)).toEqual({ status: "released" });
    expect(await releasePmScanJob(db, first.lease)).toEqual({ status: "stale-lease" });
    expect(await job(f.uploadId)).toMatchObject({ state: "PENDING", generation: "1", lease_owner: null, lease_until: null });
    expect((await claim(f.uploadId, first.lease.workerId)).lease.generation).toBe(2n);
    expect(await releasePmScanJob(db, first.lease)).toEqual({ status: "stale-lease" });
    expect(await attempts(f.uploadId)).toHaveLength(2);
  });

  it("does not claim finished, future or nonexistent jobs", async () => {
    const finished = await fixture(), future = await fixture();
    await pool.query("UPDATE pm_scan_job SET state='FINISHED' WHERE upload_id=$1", [finished.uploadId]);
    await pool.query("UPDATE pm_scan_job SET created_at=clock_timestamp()+interval '1 day' WHERE upload_id=$1", [future.uploadId]);
    for (const uploadId of [finished.uploadId, future.uploadId, randomUUID()]) {
      expect(await claimPmScanJob(db, { uploadId, workerId: randomUUID() })).toEqual({ status: "no-job" });
      expect(await attempts(uploadId)).toHaveLength(0);
    }
  });

  it("uses fresh DB time after a release has waited on a real row lock", async () => {
    const f = await fixture(), first = await claim(f.uploadId);
    const name = `pm_scan_wait_${randomUUID()}`;
    const workerUrl = new URL(url); workerUrl.searchParams.set("application_name", name);
    const worker = createDatabase(workerUrl.toString()), blocker = await pool.connect();
    let pending: ReturnType<typeof releasePmScanJob> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE pm_scan_job SET lease_until=clock_timestamp()+interval '300 milliseconds' WHERE upload_id=$1", [f.uploadId]);
      pending = releasePmScanJob(worker.db, first.lease);
      let observedWait = false;
      for (let index = 0; index < 100; index++) {
        const activity = await pool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [name]);
        if (activity.rowCount === 1) { observedWait = true; break; }
        await pool.query("SELECT pg_sleep(0.01)");
      }
      expect(observedWait).toBe(true);
      await blocker.query("SELECT pg_sleep(0.35)");
      await blocker.query("COMMIT");
      expect(await pending).toEqual({ status: "stale-lease" });
      expect((await job(f.uploadId)).state).toBe("LEASED");
    } finally {
      await blocker.query("ROLLBACK"); blocker.release();
      if (pending) await pending;
      await worker.pool.end();
    }
  });

  it("skips exhausted jobs in global selection rather than starving other work", async () => {
    const exhausted = await fixture(), available = await fixture();
    // Keep repeated runs independent of retained, possibly expired old fixtures.
    // Only these two new rows change; all old attempts and jobs are preserved.
    await pool.query("UPDATE pm_scan_job SET created_at=(SELECT min(created_at)-interval '2 days' FROM pm_scan_job),generation=9223372036854775807 WHERE upload_id=$1", [exhausted.uploadId]);
    await pool.query("UPDATE pm_scan_job SET created_at=(SELECT created_at+interval '1 day' FROM pm_scan_job WHERE upload_id=$2) WHERE upload_id=$1", [available.uploadId, exhausted.uploadId]);
    const result = await claimPmScanJob(db, { workerId: randomUUID() });
    expect(result.status).toBe("claimed");
    if (result.status !== "claimed") throw new Error("Expected global claim");
    expect(result.lease.uploadId).toBe(available.uploadId);
    expect(await attempts(exhausted.uploadId)).toHaveLength(0);
  });

  it("rejects orphan attempts, invalid lease duration, nonpositive and duplicate generations", async () => {
    const f = await fixture(), first = await claim(f.uploadId);
    const insert = (uploadId: string, generation: string, duration: string) => pool.query(`INSERT INTO pm_scan_attempt
      (upload_id,generation,lease_owner,leased_at,lease_until) VALUES($1,$2,$3,now(),now()+$4::interval)`,
    [uploadId, generation, first.lease.workerId, duration]);
    await expect(insert(randomUUID(), "1", "5 minutes")).rejects.toMatchObject({ code: "23503" });
    await expect(insert(f.uploadId, "0", "5 minutes")).rejects.toMatchObject({ code: "23514" });
    await expect(insert(f.uploadId, "2", "6 minutes")).rejects.toMatchObject({ code: "23514" });
    await expect(insert(f.uploadId, "1", "5 minutes")).rejects.toMatchObject({ code: "23505" });
    expect(await attempts(f.uploadId)).toHaveLength(1);
  });

  it("preserves bigint precision and refuses overflow without state changes", async () => {
    const f = await fixture();
    await pool.query("UPDATE pm_scan_job SET generation=9007199254740993 WHERE upload_id=$1", [f.uploadId]);
    const result = await claim(f.uploadId);
    expect(result.lease.generation).toBe(9007199254740994n);
    expect(await releasePmScanJob(db, result.lease)).toEqual({ status: "released" });
    await pool.query("UPDATE pm_scan_job SET generation=9223372036854775807 WHERE upload_id=$1", [f.uploadId]);
    expect(await claimPmScanJob(db, { uploadId: f.uploadId, workerId: randomUUID() })).toEqual({ status: "generation-exhausted" });
    expect(await job(f.uploadId)).toMatchObject({ state: "PENDING", generation: "9223372036854775807" });
    expect(await attempts(f.uploadId)).toHaveLength(1);
  });

  it("rolls back the attempt if the job update cannot commit", async () => {
    const f = await fixture(), constraint = `test_pm_scan_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`ALTER TABLE pm_scan_job ADD CONSTRAINT ${constraint} CHECK (upload_id <> '${f.uploadId}' OR state::text <> 'LEASED')`);
    try { await expect(claim(f.uploadId)).rejects.toMatchObject({ cause: { code: "23514" } }); }
    finally { await pool.query(`ALTER TABLE pm_scan_job DROP CONSTRAINT ${constraint}`); }
    expect(await attempts(f.uploadId)).toHaveLength(0);
    expect(await job(f.uploadId)).toMatchObject({ state: "PENDING", generation: "0" });
    expect((await claim(f.uploadId)).lease.generation).toBe(1n);
  });

  it("validates canonical IDs and generation before database access", async () => {
    expect(await claimPmScanJob(db, { workerId: "not-a-worker" })).toEqual({ status: "invalid-input" });
    expect(await claimPmScanJob(db, { workerId: randomUUID(), uploadId: "bad" })).toEqual({ status: "invalid-input" });
    expect(await releasePmScanJob(db, { uploadId: randomUUID(), workerId: randomUUID(), generation: 0n })).toEqual({ status: "invalid-input" });
  });
});

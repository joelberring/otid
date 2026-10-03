import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const hash = "a".repeat(64);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), actorId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Synthetic PM", startsOn: "2026-09-07", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Synthetic PM", raceDate: "2026-09-07" });
  await pool.query(`INSERT INTO pairing_admin_access_credential
    (id,race_id,capability,label,secret_hash,issued_at,expires_at)
    VALUES ($1,$2,'MANAGE_PM_DOCUMENT','Synthetic',$3,'2026-09-07T10:00:00Z','2026-09-07T18:00:00Z')`, [actorId, raceId, hash]);
  return { raceId, actorId };
}
async function reserve(f: { raceId: string; actorId: string }, slot = 1, id = randomUUID(), requestId = randomUUID()) {
  await pool.query(`INSERT INTO pm_upload_reservation
    (id,request_id,race_id,actor_credential_id,capability,slot,title,media_type,sha256,byte_length,reserved_at)
    VALUES ($1,$2,$3,$4,'MANAGE_PM_DOCUMENT',$5,'Synthetic PM','application/pdf',$6,1024,now())`,
  [id, requestId, f.raceId, f.actorId, slot, hash]);
  return id;
}
async function charge(uploadId: string, raceId: string, attemptNumber = 1, id = randomUUID(), sha256 = hash, byteLength = 1024) {
  await pool.query(`INSERT INTO pm_upload_attempt
    (id,upload_id,race_id,attempt_number,sha256,byte_length,charged_at) VALUES ($1,$2,$3,$4,$5,$6,now())`,
  [id, uploadId, raceId, attemptNumber, sha256, byteLength]);
  return id;
}
async function complete(uploadId: string, raceId: string, attemptId: string, key = `pm/${raceId}/${attemptId}`, version = "v1") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO pm_object_manifest
      (upload_id,attempt_id,race_id,store_id,object_key,version_id,sha256,byte_length,stored_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,1024,now())`, [uploadId, attemptId, raceId, randomUUID(), key, version, hash]);
    await client.query(`INSERT INTO pm_scan_job (upload_id,state,generation,created_at) VALUES ($1,'PENDING',0,now())`, [uploadId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

describe("TASK013 durable PM upload schema (no scanner or publication proof)", () => {
  it("binds authority to race and capability with an eight-hour maximum", async () => {
    const f = await fixture(), other = await fixture();
    await expect(reserve({ ...f, actorId: other.actorId })).rejects.toMatchObject({ code: "23503" });
    const wrong = randomUUID();
    await pool.query(`INSERT INTO pairing_admin_access_credential
      (id,race_id,capability,label,secret_hash,issued_at,expires_at)
      VALUES ($1,$2,'VIEW_SPEAKER_BOARD','Synthetic',$3,now(),now()+interval '1 hour')`, [wrong, f.raceId, hash]);
    await expect(reserve({ ...f, actorId: wrong })).rejects.toMatchObject({ code: "23503" });
    await expect(pool.query(`INSERT INTO pairing_admin_access_credential
      (id,race_id,capability,label,secret_hash,issued_at,expires_at)
      VALUES ($1,$2,'MANAGE_PM_DOCUMENT','Synthetic',$3,now(),now()+interval '8 hours 1 second')`,
    [randomUUID(), f.raceId, hash])).rejects.toMatchObject({ code: "23514" });
  });

  it("reserves at most 100 slots and rejects duplicate request identities", async () => {
    const f = await fixture(), requestId = randomUUID();
    await reserve(f, 1, randomUUID(), requestId);
    await expect(reserve(f, 2, randomUUID(), requestId)).rejects.toMatchObject({ code: "23505" });
    for (let slot = 2; slot <= 100; slot++) await reserve(f, slot);
    await expect(reserve(f, 101)).rejects.toMatchObject({ code: "23514" });
    await expect(reserve(f, 100)).rejects.toMatchObject({ code: "23505" });
    const result = await pool.query<{ count: string }>("SELECT count(*) FROM pm_upload_reservation WHERE race_id=$1", [f.raceId]);
    expect(result.rows[0]?.count).toBe("100");
  });

  it("does not overbook the same reservation slot under concurrent inserts", async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([reserve(f), reserve(f)]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    const result = await pool.query<{ count: string }>("SELECT count(*) FROM pm_upload_reservation WHERE race_id=$1", [f.raceId]);
    expect(result.rows[0]?.count).toBe("1");
  });

  it("charges at most eight exact-scope attempts including uncertain outcomes", async () => {
    const f = await fixture(), other = await fixture(), uploadId = await reserve(f);
    await expect(charge(uploadId, other.raceId)).rejects.toMatchObject({ code: "23503" });
    await expect(charge(uploadId, f.raceId, 1, randomUUID(), "b".repeat(64))).rejects.toMatchObject({ code: "23503" });
    await expect(charge(uploadId, f.raceId, 1, randomUUID(), hash, 1025)).rejects.toMatchObject({ code: "23503" });
    const concurrent = await Promise.allSettled([charge(uploadId, f.raceId), charge(uploadId, f.raceId)]);
    expect(concurrent.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter(result => result.status === "rejected")).toHaveLength(1);
    for (let number = 2; number <= 8; number++) await charge(uploadId, f.raceId, number);
    await expect(charge(uploadId, f.raceId, 9)).rejects.toMatchObject({ code: "23514" });
    await expect(charge(uploadId, f.raceId, 8)).rejects.toMatchObject({ code: "23505" });
    const charged = await pool.query<{ bytes: string }>("SELECT sum(byte_length) AS bytes FROM pm_upload_attempt WHERE upload_id=$1", [uploadId]);
    expect(charged.rows[0]?.bytes).toBe("8192");
  });

  it("requires the matching attempt, canonical key and a real version for one manifest", async () => {
    const f = await fixture(), uploadId = await reserve(f), second = await reserve(f, 2);
    const attemptId = await charge(uploadId, f.raceId), otherAttempt = await charge(second, f.raceId);
    await expect(complete(uploadId, f.raceId, otherAttempt)).rejects.toMatchObject({ code: "23503" });
    await expect(complete(uploadId, f.raceId, attemptId, "pm/wrong/key")).rejects.toMatchObject({ code: "23514" });
    await expect(complete(uploadId, f.raceId, attemptId, undefined, "null")).rejects.toMatchObject({ code: "23514" });
    await expect(complete(uploadId, f.raceId, attemptId, undefined, " version ")).rejects.toMatchObject({ code: "23514" });
    await expect(complete(uploadId, f.raceId, attemptId, undefined, "x".repeat(1025))).rejects.toMatchObject({ code: "23514" });
    await complete(uploadId, f.raceId, attemptId);
    await expect(complete(uploadId, f.raceId, attemptId)).rejects.toMatchObject({ code: "23505" });
  });

  it("rolls back a manifest without its durable job and rejects a job without a manifest", async () => {
    const f = await fixture(), uploadId = await reserve(f), attemptId = await charge(uploadId, f.raceId);
    await expect(pool.query(`INSERT INTO pm_object_manifest
      (upload_id,attempt_id,race_id,store_id,object_key,version_id,sha256,byte_length,stored_at)
      VALUES ($1,$2,$3,$4,$5,'v1',$6,1024,now())`, [uploadId, attemptId, f.raceId, randomUUID(), `pm/${f.raceId}/${attemptId}`, hash]))
      .rejects.toMatchObject({ code: "23503" });
    expect((await pool.query("SELECT upload_id FROM pm_object_manifest WHERE upload_id=$1", [uploadId])).rowCount).toBe(0);
    await expect(pool.query("INSERT INTO pm_scan_job (upload_id,state,generation,created_at) VALUES ($1,'PENDING',0,now())", [uploadId]))
      .rejects.toMatchObject({ code: "23503" });
    await complete(uploadId, f.raceId, attemptId);
    expect((await pool.query("SELECT upload_id FROM pm_scan_job WHERE upload_id=$1", [uploadId])).rowCount).toBe(1);
  });

  it("preserves reservation, charged attempts and manifests against update or delete", async () => {
    const f = await fixture(), uploadId = await reserve(f), attemptId = await charge(uploadId, f.raceId);
    await complete(uploadId, f.raceId, attemptId);
    for (const statement of [
      "UPDATE pm_upload_reservation SET title='Changed' WHERE id=$1",
      "DELETE FROM pm_upload_reservation WHERE id=$1",
      "UPDATE pm_upload_attempt SET byte_length=2048 WHERE upload_id=$1",
      "DELETE FROM pm_upload_attempt WHERE upload_id=$1",
      "UPDATE pm_object_manifest SET version_id='v2' WHERE upload_id=$1",
      "DELETE FROM pm_object_manifest WHERE upload_id=$1"
    ]) await expect(pool.query(statement, [uploadId])).rejects.toMatchObject({ code: "P0001" });
  });

  it("does not represent pending work as READY and requires a complete lease tuple", async () => {
    const f = await fixture(), uploadId = await reserve(f), attemptId = await charge(uploadId, f.raceId);
    await complete(uploadId, f.raceId, attemptId);
    await expect(pool.query("UPDATE pm_scan_job SET state='READY' WHERE upload_id=$1", [uploadId])).rejects.toMatchObject({ code: "22P02" });
    await expect(pool.query("UPDATE pm_scan_job SET state='LEASED' WHERE upload_id=$1", [uploadId])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE pm_scan_job SET lease_owner=$2 WHERE upload_id=$1", [uploadId, randomUUID()])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE pm_scan_job SET lease_until=now()+interval '1 minute' WHERE upload_id=$1", [uploadId])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE pm_scan_job SET generation=-1 WHERE upload_id=$1", [uploadId])).rejects.toMatchObject({ code: "23514" });
    await pool.query("UPDATE pm_scan_job SET state='LEASED',generation=1,lease_owner=$2,lease_until=now()+interval '1 minute' WHERE upload_id=$1", [uploadId, randomUUID()]);
    await expect(pool.query("UPDATE pm_scan_job SET state='PENDING' WHERE upload_id=$1", [uploadId])).rejects.toMatchObject({ code: "23514" });
    // State shape is a schema invariant; stale-worker fencing needs application CAS tests.
  });

  it("preserves lease generations exactly across the TypeScript database boundary", async () => {
    const f = await fixture(), uploadId = await reserve(f), attemptId = await charge(uploadId, f.raceId);
    await complete(uploadId, f.raceId, attemptId);
    await pool.query("UPDATE pm_scan_job SET generation=9007199254740993 WHERE upload_id=$1", [uploadId]);
    const [job] = await db.select().from(schema.pmScanJobs).where(eq(schema.pmScanJobs.uploadId, uploadId));
    expect(job?.generation).toBe(9007199254740993n);
  });
});

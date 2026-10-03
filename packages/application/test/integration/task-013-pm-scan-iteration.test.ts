import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { claimPmScanJob } from "../../src/pm-scan-jobs";
import { runPmScanIteration, type PmScanIterationPorts } from "../../src/pm-scan-iteration";
import { pmScanEvidenceFixture } from "../../../contracts/test/fixtures/pm-scan";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture(bytes = Buffer.from("Synthetic PM iteration bytes\n")) {
  const eventId = randomUUID(), raceId = randomUUID(), actorId = randomUUID();
  const uploadId = randomUUID(), attemptId = randomUUID(), storeId = randomUUID();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Synthetic iteration','2026-09-08','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Synthetic iteration','2026-09-08')", [raceId, eventId]);
  await pool.query(`INSERT INTO pairing_admin_access_credential(id,race_id,capability,label,secret_hash,issued_at,expires_at)
    VALUES($1,$2,'MANAGE_PM_DOCUMENT','Synthetic',$3,now(),now()+interval '1 hour')`, [actorId, raceId, "a".repeat(64)]);
  await pool.query(`INSERT INTO pm_upload_reservation(id,request_id,race_id,actor_credential_id,capability,slot,title,media_type,sha256,byte_length,reserved_at)
    VALUES($1,$2,$3,$4,'MANAGE_PM_DOCUMENT',1,'Synthetic PM','application/pdf',$5,$6,now())`, [uploadId, randomUUID(), raceId, actorId, sha256, bytes.byteLength]);
  await pool.query(`INSERT INTO pm_upload_attempt(id,upload_id,race_id,attempt_number,sha256,byte_length,charged_at)
    VALUES($1,$2,$3,1,$4,$5,now())`, [attemptId, uploadId, raceId, sha256, bytes.byteLength]);
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(`INSERT INTO pm_object_manifest(upload_id,attempt_id,race_id,store_id,object_key,version_id,sha256,byte_length,stored_at)
    VALUES($1,$2,$3,$4,$5,'exact-v1',$6,$7,now())`, [uploadId, attemptId, raceId, storeId, `pm/${raceId}/${attemptId}`, sha256, bytes.byteLength]);
    await connection.query("INSERT INTO pm_scan_job(upload_id,created_at) VALUES($1,now()-interval '1 hour')", [uploadId]);
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally { connection.release(); }
  return { uploadId, bytes };
}

function ports(bytes: Uint8Array, mutate?: (evidence: ReturnType<typeof pmScanEvidenceFixture>) => void) {
  let reads = 0, scans = 0;
  const value: PmScanIterationPorts = {
    async read() { reads++; return bytes; },
    async scan({ manifest }) {
      scans++;
      const evidence = pmScanEvidenceFixture();
      evidence.manifest = manifest;
      const now = new Date();
      evidence.startedAt = now.toISOString(); evidence.finishedAt = now.toISOString();
      for (const name of ["daily", "main", "bytecode"] as const) evidence.clamav!.databases![name].builtAt = new Date(now.getTime() - 60_000).toISOString();
      mutate?.(evidence);
      return evidence;
    }
  };
  return { value, counts: () => ({ reads, scans }) };
}

async function reportCount(uploadId: string) {
  return (await pool.query("SELECT id FROM pm_scan_report WHERE upload_id=$1", [uploadId])).rowCount;
}

describe("TASK013 one durable PM scan iteration; ports are synthetic and never a production scanner", () => {
  it("ignores a read that resolves after the actual deadline timer aborted the attempt", async () => {
    const f = await fixture(), scan = vi.fn();
    // Leave only one real millisecond for the read. PostgreSQL timers and
    // wall-clock timestamps remain real; no global fake timers are installed.
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(1_000).mockReturnValue(240_999);
    let signal: AbortSignal | undefined;
    let resolveRead: ((bytes: Uint8Array) => void) | undefined;
    const lateRead = new Promise<Uint8Array>(resolve => { resolveRead = resolve; });
    const value: PmScanIterationPorts = {
      async read(_manifest, receivedSignal) { signal = receivedSignal; return lateRead; },
      scan
    };
    try {
      expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: f.uploadId }, value)).toEqual({ status: "attempt-failed" });
      expect(signal?.aborted).toBe(true);
      resolveRead!(f.bytes);
      await lateRead;
      await Promise.resolve();
      expect(scan).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); resolveRead!(f.bytes); }
    expect(await reportCount(f.uploadId)).toBe(0);
  });

  it.each(["read", "scan"] as const)("rejects a late %s resolution even before its timeout callback runs", async stage => {
    const f = await fixture(), probe = ports(f.bytes);
    let monotonic = 1_000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => monotonic);
    let signal: AbortSignal | undefined;
    const value: PmScanIterationPorts = {
      async read(manifest, receivedSignal) {
        signal = receivedSignal;
        const result = await probe.value.read(manifest, receivedSignal);
        if (stage === "read") monotonic += 240_000;
        return result;
      },
      async scan(input) {
        const result = await probe.value.scan(input);
        monotonic += 240_000;
        return result;
      }
    };
    try {
      expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: f.uploadId }, value)).toEqual({ status: "attempt-failed" });
      expect(signal?.aborted).toBe(true);
      expect(probe.counts()).toEqual({ reads: 1, scans: stage === "read" ? 0 : 1 });
    } finally { clock.mockRestore(); }
    expect(await reportCount(f.uploadId)).toBe(0);
  });

  it("does not allow a read port to replace the expected checksum", async () => {
    const f = await fixture(), replacement = Buffer.from("Different synthetic document"), scan = vi.fn();
    let signal: AbortSignal | undefined;
    const value: PmScanIterationPorts = {
      async read(manifest, receivedSignal) {
        signal = receivedSignal;
        manifest.sha256 = createHash("sha256").update(replacement).digest("hex");
        manifest.byteLength = replacement.byteLength;
        return replacement;
      },
      scan
    };
    expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: f.uploadId }, value)).toEqual({ status: "attempt-failed" });
    expect(scan).not.toHaveBeenCalled();
    expect(signal?.aborted).toBe(true);
    expect(await reportCount(f.uploadId)).toBe(0);
  });

  it("owns storage bytes and gives the scanner an independent original manifest", async () => {
    const f = await fixture(), originalBytes = Buffer.from(f.bytes), probe = ports(f.bytes);
    let readManifest: Parameters<PmScanIterationPorts["read"]>[0] | undefined;
    let signal: AbortSignal | undefined;
    const value: PmScanIterationPorts = {
      async read(manifest, receivedSignal) {
        readManifest = manifest;
        signal = receivedSignal;
        manifest.versionId = "changed-by-read-port";
        return f.bytes;
      },
      async scan(input) {
        expect(input.manifest).not.toBe(readManifest);
        expect(input.manifest.versionId).toBe("exact-v1");
        f.bytes.fill(0);
        expect(Buffer.from(input.bytes)).toEqual(originalBytes);
        expect(input.signal.aborted).toBe(false);
        return probe.value.scan(input);
      }
    };
    expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: f.uploadId }, value))
      .toMatchObject({ status: "recorded", outcome: "PASSED", publishable: false });
    expect(signal?.aborted).toBe(true);
    expect(await reportCount(f.uploadId)).toBe(1);
  });

  it.each(["invalid-evidence", "read-throw", "scan-throw"] as const)("aborts the shared signal on %s", async failure => {
    const f = await fixture();
    let signal: AbortSignal | undefined;
    const value: PmScanIterationPorts = {
      async read(_manifest, receivedSignal) {
        signal = receivedSignal;
        if (failure === "read-throw") throw new Error("Synthetic read failure");
        return f.bytes;
      },
      async scan(input) {
        expect(input.signal).toBe(signal);
        if (failure === "scan-throw") throw new Error("Synthetic scan failure");
        return { invalid: true };
      }
    };
    expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: f.uploadId }, value)).toEqual({ status: "attempt-failed" });
    expect(signal?.aborted).toBe(true);
    expect(await reportCount(f.uploadId)).toBe(0);
  });

  it("aborts on report database failure without disguising an unknown commit as a port failure", async () => {
    const f = await fixture(), probe = ports(f.bytes), failure = new Error("Synthetic report transaction failure");
    let signal: AbortSignal | undefined;
    const transaction = vi.spyOn(db, "transaction");
    const value: PmScanIterationPorts = {
      async read(_manifest, receivedSignal) { signal = receivedSignal; return f.bytes; },
      async scan(input) {
        const evidence = await probe.value.scan(input);
        // Claim has already used the real PostgreSQL transaction. Only the
        // subsequent report transaction is fault-injected in this case.
        transaction.mockRejectedValueOnce(failure);
        return evidence;
      }
    };
    try {
      await expect(runPmScanIteration(db, { workerId: randomUUID(), uploadId: f.uploadId }, value)).rejects.toBe(failure);
      expect(signal?.aborted).toBe(true);
    } finally { transaction.mockRestore(); }
    expect(await reportCount(f.uploadId)).toBe(0);
  });

  it("does not call ports when no job is claimable", async () => {
    const probe = ports(Buffer.from("unused"));
    expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: randomUUID() }, probe.value)).toEqual({ status: "no-job" });
    expect(probe.counts()).toEqual({ reads: 0, scans: 0 });
  });

  it("rejects wrong object bytes before scanning and preserves the lease without a report", async () => {
    const f = await fixture(), probe = ports(Buffer.from(f.bytes.map((byte, index) => index === 0 ? byte ^ 1 : byte)));
    expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: f.uploadId }, probe.value)).toEqual({ status: "attempt-failed" });
    expect(probe.counts()).toEqual({ reads: 1, scans: 0 });
    expect(await reportCount(f.uploadId)).toBe(0);
    expect((await pool.query("SELECT state FROM pm_scan_job WHERE upload_id=$1", [f.uploadId])).rows).toEqual([{ state: "LEASED" }]);
  });

  it("records successful native evidence once and does not re-read or re-scan a FINISHED job", async () => {
    const f = await fixture(), probe = ports(f.bytes);
    const first = await runPmScanIteration(db, { workerId: randomUUID(), uploadId: f.uploadId }, probe.value);
    expect(first).toMatchObject({ status: "recorded", outcome: "PASSED", publishable: false, replayed: false });
    expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: f.uploadId }, probe.value)).toEqual({ status: "no-job" });
    expect(probe.counts()).toEqual({ reads: 1, scans: 1 });
    expect(await reportCount(f.uploadId)).toBe(1);
  });

  it("rejects malformed or substituted evidence without accepting a report", async () => {
    const malformed = await fixture();
    const malformedPorts: PmScanIterationPorts = { async read() { return malformed.bytes; }, async scan() { return { nope: true }; } };
    expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: malformed.uploadId }, malformedPorts)).toEqual({ status: "attempt-failed" });
    expect(await reportCount(malformed.uploadId)).toBe(0);

    const substituted = await fixture();
    const probe = ports(substituted.bytes, evidence => { evidence.manifest = { ...evidence.manifest, versionId: "other" }; });
    expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: substituted.uploadId }, probe.value)).toEqual({ status: "attempt-failed" });
    expect(await reportCount(substituted.uploadId)).toBe(0);
  });

  it("cannot record after another worker takes over during object read", async () => {
    const f = await fixture(), firstWorker = randomUUID(), nextWorker = randomUUID();
    let resume: (() => void) | undefined;
    let started: (() => void) | undefined;
    const reading = new Promise<void>(resolve => { started = resolve; });
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    let signal: AbortSignal | undefined;
    const probe: PmScanIterationPorts = {
      async read(_manifest, receivedSignal) { signal = receivedSignal; started!(); await blocked; return f.bytes; },
      async scan({ manifest }) {
        const evidence = pmScanEvidenceFixture(), now = new Date();
        evidence.manifest = manifest; evidence.startedAt = now.toISOString(); evidence.finishedAt = now.toISOString();
        for (const name of ["daily", "main", "bytecode"] as const) evidence.clamav!.databases![name].builtAt = new Date(now.getTime() - 60_000).toISOString();
        return evidence;
      }
    };
    const pending = runPmScanIteration(db, { workerId: firstWorker, uploadId: f.uploadId }, probe);
    await reading;
    await pool.query("UPDATE pm_scan_job SET lease_until=clock_timestamp()-interval '1 second' WHERE upload_id=$1", [f.uploadId]);
    const replacement = await claimPmScanJob(db, { workerId: nextWorker, uploadId: f.uploadId });
    expect(replacement.status).toBe("claimed");
    resume!();
    expect(await pending).toEqual({ status: "stale-lease" });
    expect(signal?.aborted).toBe(true);
    expect(await reportCount(f.uploadId)).toBe(0);
  });

  it("persists rejected and failed evidence, while port failures create no report", async () => {
    const rejected = await fixture(), rejectedPorts = ports(rejected.bytes, evidence => {
      evidence.qpdf!.encryption!.exitCode = 0; evidence.qpdf!.check = null; evidence.clamav = null;
    });
    expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: rejected.uploadId }, rejectedPorts.value))
      .toMatchObject({ status: "recorded", outcome: "REJECTED", publishable: false });
    const failed = await fixture(), failedPorts = ports(failed.bytes, evidence => { evidence.qpdf = null; evidence.clamav = null; });
    expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: failed.uploadId }, failedPorts.value))
      .toMatchObject({ status: "recorded", outcome: "FAILED", publishable: false });

    const readFailure = await fixture();
    const throwingRead: PmScanIterationPorts = { async read() { throw new Error("synthetic read failure"); }, async scan() { throw new Error("must not scan"); } };
    expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: readFailure.uploadId }, throwingRead)).toEqual({ status: "attempt-failed" });
    expect(await reportCount(readFailure.uploadId)).toBe(0);
    const scanFailure = await fixture();
    const throwingScan: PmScanIterationPorts = { async read() { return scanFailure.bytes; }, async scan() { throw new Error("synthetic scan failure"); } };
    expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: scanFailure.uploadId }, throwingScan)).toEqual({ status: "attempt-failed" });
    expect(await reportCount(scanFailure.uploadId)).toBe(0);
  });
});

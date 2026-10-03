import { and, asc, eq, or, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { pmObjectManifestSchema } from "@o-tid/contracts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maximumGeneration = 9223372036854775807n;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export interface PmScanLease {
  uploadId: string;
  generation: bigint;
  workerId: string;
}

async function databaseTime(tx: Transaction): Promise<Date> {
  // Millisecond precision survives the Node Date boundary without changing the
  // DB authority or the exact five-minute attempt constraint.
  const result = await tx.execute<{ milliseconds: string }>(sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text AS milliseconds`);
  const value = result.rows[0]?.milliseconds;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) throw new Error("PM_SCAN_CLOCK_INVALID");
  const milliseconds = Number(value);
  const now = new Date(milliseconds);
  if (!Number.isSafeInteger(milliseconds) || !Number.isFinite(now.getTime())) throw new Error("PM_SCAN_CLOCK_INVALID");
  return now;
}

/** Trusted worker composition only. Never expose worker identity or selection as a public request. */
export async function claimPmScanJob(db: Database, input: { workerId: string; uploadId?: string }) {
  if (!uuid.test(input.workerId) || (input.uploadId !== undefined && !uuid.test(input.uploadId))) {
    return { status: "invalid-input" as const };
  }
  return db.transaction(async tx => {
    const jobs = schema.pmScanJobs;
    const [job] = await tx.select().from(jobs).where(and(
      input.uploadId === undefined ? undefined : eq(jobs.uploadId, input.uploadId),
      input.uploadId === undefined ? sql`${jobs.generation} < ${maximumGeneration}` : undefined,
      sql`${jobs.createdAt} <= clock_timestamp()`,
      or(eq(jobs.state, "PENDING"), and(eq(jobs.state, "LEASED"), sql`${jobs.leaseUntil} <= clock_timestamp()`))
    )).orderBy(asc(jobs.createdAt), asc(jobs.uploadId)).limit(1).for("update", { skipLocked: true });
    if (!job) return { status: "no-job" as const };
    if (job.generation >= maximumGeneration) return { status: "generation-exhausted" as const };
    const now = await databaseTime(tx);
    if (job.createdAt > now || (job.state === "LEASED" && (!job.leaseUntil || job.leaseUntil > now))) {
      return { status: "no-job" as const };
    }
    const [stored] = await tx.select().from(schema.pmObjectManifests).where(eq(schema.pmObjectManifests.uploadId, job.uploadId));
    if (!stored) throw new Error("PM_SCAN_MANIFEST_MISSING");
    const manifest = pmObjectManifestSchema.parse({ formatVersion: 1, storeId: stored.storeId,
      key: stored.objectKey, versionId: stored.versionId, sha256: stored.sha256, byteLength: stored.byteLength });
    const generation = job.generation + 1n;
    const leaseUntil = new Date(now.getTime() + 300_000);
    await tx.insert(schema.pmScanAttempts).values({ uploadId: job.uploadId, generation,
      leaseOwner: input.workerId, leasedAt: now, leaseUntil });
    await tx.update(jobs).set({ state: "LEASED", generation, leaseOwner: input.workerId, leaseUntil })
      .where(eq(jobs.uploadId, job.uploadId));
    return { status: "claimed" as const, lease: { uploadId: job.uploadId, generation, workerId: input.workerId },
      leasedAt: now, leaseUntil, manifest };
  }, { isolationLevel: "read committed" });
}

/** Abandon work without accepting a scan. Expired or replaced workers cannot change current state. */
export async function releasePmScanJob(db: Database, lease: PmScanLease) {
  if (!uuid.test(lease.uploadId) || !uuid.test(lease.workerId) || typeof lease.generation !== "bigint" ||
    lease.generation < 1n || lease.generation > maximumGeneration) return { status: "invalid-input" as const };
  return db.transaction(async tx => {
    const jobs = schema.pmScanJobs;
    const [job] = await tx.select().from(jobs).where(eq(jobs.uploadId, lease.uploadId)).for("update");
    if (!job || job.state !== "LEASED" || job.generation !== lease.generation ||
      job.leaseOwner !== lease.workerId || !job.leaseUntil) {
      return { status: "stale-lease" as const };
    }
    const [released] = await tx.update(jobs).set({ state: "PENDING", leaseOwner: null, leaseUntil: null }).where(and(
      eq(jobs.uploadId, lease.uploadId), eq(jobs.generation, lease.generation),
      eq(jobs.leaseOwner, lease.workerId), eq(jobs.state, "LEASED"), sql`${jobs.leaseUntil} > clock_timestamp()`
    )).returning({ uploadId: jobs.uploadId });
    return released ? { status: "released" as const } : { status: "stale-lease" as const };
  }, { isolationLevel: "read committed" });
}

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { canonicalJsonBytes, pmScanEvidenceSchema } from "@o-tid/contracts";
import type { PmScanLease } from "./pm-scan-jobs";
import { classifyPmScanEvidence } from "./pm-scan-policy";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
class ExpiredDuringCommit extends Error {}
function receipt(row: typeof schema.pmScanReports.$inferSelect, replayed: boolean) {
  return { status: "recorded" as const, reportId: row.id, outcome: row.outcome,
    publishable: false as const, recordedAt: row.recordedAt, replayed };
}

/** Trusted scanner composition only. Observations are not accepted from any HTTP client. */
export async function recordPmScanReport(db: Database, lease: PmScanLease, input: unknown) {
  if (!uuid.test(lease.uploadId) || !uuid.test(lease.workerId) || typeof lease.generation !== "bigint" ||
    lease.generation < 1n || lease.generation > 9223372036854775807n) return { status: "invalid-input" as const };
  const parsed = pmScanEvidenceSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid-input" as const };
  const evidence = parsed.data;
  const bytes = Buffer.from(canonicalJsonBytes(evidence));
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  try {
    return await db.transaction(async tx => {
      const jobs = schema.pmScanJobs, reports = schema.pmScanReports, attempts = schema.pmScanAttempts;
      const [job] = await tx.select().from(jobs).where(eq(jobs.uploadId, lease.uploadId)).for("update");
      if (!job) return { status: "stale-lease" as const };
      const [existing] = await tx.select().from(reports).where(and(eq(reports.uploadId, lease.uploadId), eq(reports.generation, lease.generation)));
      if (existing) {
        if (existing.leaseOwner !== lease.workerId || existing.contentHash !== contentHash ||
          !bytes.equals(Buffer.from(canonicalJsonBytes(existing.evidence)))) return { status: "conflict" as const };
        return receipt(existing, true);
      }
      if (job.state !== "LEASED" || job.generation !== lease.generation || job.leaseOwner !== lease.workerId) {
        return { status: "stale-lease" as const };
      }
      const [attempt] = await tx.select().from(attempts).where(and(eq(attempts.uploadId, lease.uploadId),
        eq(attempts.generation, lease.generation), eq(attempts.leaseOwner, lease.workerId)));
      if (!attempt) return { status: "stale-lease" as const };
      const [manifest] = await tx.select().from(schema.pmObjectManifests).where(eq(schema.pmObjectManifests.uploadId, lease.uploadId));
      if (!manifest) throw new Error("PM_SCAN_MANIFEST_MISSING");
      const exactManifest = { formatVersion: 1, storeId: manifest.storeId, key: manifest.objectKey,
        versionId: manifest.versionId, sha256: manifest.sha256, byteLength: manifest.byteLength };
      if (!Buffer.from(canonicalJsonBytes(exactManifest)).equals(Buffer.from(canonicalJsonBytes(evidence.manifest)))) {
        return { status: "invalid-evidence" as const };
      }
      const startedAt = new Date(evidence.startedAt), finishedAt = new Date(evidence.finishedAt);
      if (startedAt < attempt.leasedAt || finishedAt > attempt.leaseUntil) return { status: "invalid-evidence" as const };
      const [saved] = await tx.insert(reports).values({ uploadId: lease.uploadId, generation: lease.generation,
        leaseOwner: lease.workerId, outcome: classifyPmScanEvidence(evidence), publishable: false,
        evidence, contentHash }).returning();
      if (!saved) throw new Error("PM_SCAN_REPORT_NOT_STORED");
      const [finished] = await tx.update(jobs).set({ state: "FINISHED", leaseOwner: null, leaseUntil: null }).where(and(
        eq(jobs.uploadId, lease.uploadId), eq(jobs.generation, lease.generation), eq(jobs.leaseOwner, lease.workerId),
        eq(jobs.state, "LEASED"), sql`${jobs.leaseUntil} > clock_timestamp()`,
        sql`${attempt.leaseUntil.toISOString()}::timestamptz > clock_timestamp()`,
        sql`${finishedAt.toISOString()}::timestamptz <= clock_timestamp()`
      )).returning({ uploadId: jobs.uploadId });
      if (!finished) throw new ExpiredDuringCommit();
      return receipt(saved, false);
    }, { isolationLevel: "read committed" });
  } catch (error) {
    if (error instanceof ExpiredDuringCommit) return { status: "stale-lease" as const };
    throw error;
  }
}

import { createHash } from "node:crypto";
import type { PmObjectManifest } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { claimPmScanJob } from "./pm-scan-jobs";
import { recordPmScanReport } from "./pm-scan-report";

const portDeadlineMilliseconds = 240_000;

export interface PmScanIterationPorts {
  /** Reads the exact immutable object version; implementations must honor abort. */
  read(manifest: PmObjectManifest, signal: AbortSignal): Promise<Uint8Array>;
  /** Produces server-internal evidence only; it is validated again before persistence. */
  scan(input: { manifest: PmObjectManifest; bytes: Uint8Array; signal: AbortSignal }): Promise<unknown>;
}

class PmScanPortDeadline extends Error {}

async function withinPortDeadline<T>(
  controller: AbortController,
  deadline: number,
  operation: () => Promise<T>
): Promise<T> {
  const remaining = deadline - performance.now();
  if (remaining <= 0) {
    controller.abort();
    throw new PmScanPortDeadline();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PmScanPortDeadline());
    }, remaining);
  });
  try {
    // Promise.race registers rejection handling on operation. A late port
    // rejection therefore cannot become unhandled, and its late resolution
    // cannot reach the next continuation after the timeout wins.
    const value = await Promise.race([Promise.resolve().then(operation), timeout]);
    // Timers can be delayed by event-loop work. Resolution alone does not
    // prove that the operation finished inside the monotonic budget.
    if (controller.signal.aborted || performance.now() >= deadline) {
      controller.abort();
      throw new PmScanPortDeadline();
    }
    return value;
  } finally {
    clearTimeout(timer);
  }
}

function exactBytes(bytes: Uint8Array, manifest: PmObjectManifest): Uint8Array | undefined {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== manifest.byteLength) return undefined;
  // Copy at the adapter boundary: scanners must not observe a caller-owned,
  // mutable view after the storage port resolves.
  const owned = Buffer.from(bytes);
  if (createHash("sha256").update(owned).digest("hex") !== manifest.sha256) return undefined;
  return owned;
}

/**
 * Runs at most one already-durable lease. Claim/report transactions are kept
 * deliberately separate from object and scanner ports.
 */
export async function runPmScanIteration(
  db: Database,
  input: { workerId: string; uploadId?: string },
  ports: PmScanIterationPorts
) {
  const claimed = await claimPmScanJob(db, input);
  if (claimed.status !== "claimed") return claimed;

  const controller = new AbortController();
  // The database expectation is never shared with either mutable port input.
  const manifest = Object.freeze({ ...claimed.manifest });
  const deadline = performance.now() + portDeadlineMilliseconds;
  try {
    let evidence: unknown;
    try {
      const read = await withinPortDeadline(controller, deadline, () => ports.read({ ...manifest }, controller.signal));
      const bytes = exactBytes(read, manifest);
      if (!bytes) return { status: "attempt-failed" as const };
      evidence = await withinPortDeadline(controller, deadline, () => ports.scan({ manifest: { ...manifest }, bytes, signal: controller.signal }));
    } catch {
      return { status: "attempt-failed" as const };
    }

    const recorded = await recordPmScanReport(db, claimed.lease, evidence);
    if (recorded.status === "recorded" || recorded.status === "stale-lease") return recorded;
    return { status: "attempt-failed" as const };
  } finally {
    controller.abort();
  }
}

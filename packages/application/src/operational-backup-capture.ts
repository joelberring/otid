import { createHash } from "node:crypto";
import {
  canonicalOperationalBackupManifestBytes,
  operationalBackupCaptureIntentSchema,
  operationalBackupManifestSchema,
  normalizeOperationalBackupOperationState,
  operationalBackupPostgresDumpSchema,
  type OperationalBackupOperationState,
  operationalBackupRunIntentSchema,
  type OperationalBackupCaptureIntent,
  type OperationalBackupManifest,
  type OperationalBackupRunIntent
} from "@o-tid/contracts";
import type { OperationalBackupSourcePreflight } from "./operational-backup-source-preflight";

type ErrorCode =
  | "DUMP_UNAVAILABLE"
  | "SOURCE_PREFLIGHT_FAILED"
  | "SOURCE_PREFLIGHT_INVALID"
  | "SOURCE_STORE_UNSUPPORTED"
  | "TARGET_PREPARATION_FAILED"
  | "REPLICATION_FAILED"
  | "FINAL_VERIFICATION_FAILED"
  | "OPERATION_STATE_FAILED";

/** A secret-free failure code for the private operational worker. */
export class OperationalBackupCaptureError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = "OperationalBackupCaptureError";
  }
}

export type OperationalBackupSourcePreflightRunner = {
  prepare(captureIntent: OperationalBackupCaptureIntent): Promise<OperationalBackupSourcePreflight>;
};

/**
 * Infrastructure owns all I/O behind these ports. The application layer only
 * enforces ADR-0140's order and refuses a receipt until cleanup has succeeded.
 */
export type OperationalBackupCapturePorts = {
  createPostgresDump(): Promise<unknown>;
  prepareEmptyTarget(sourceEvidence: OperationalBackupSourceCaptureEvidence): Promise<void>;
  replicateAndCleanup(sourceEvidence: OperationalBackupSourceCaptureEvidence): Promise<void>;
  verifyCompletion(sourceEvidence: OperationalBackupSourceCaptureEvidence): Promise<OperationalBackupCaptureReceipt>;
  recordOperationState(state: OperationalBackupOperationState): Promise<void>;
};

export type OperationalBackupCaptureReceipt = {
  backupId: string;
  manifestSha256: string;
  verifiedPmObjectCount: number;
};

/** Källbevis från source-only capture; detta är inte en färdig backupkvittens. */
export type OperationalBackupSourceCaptureEvidence = {
  kind: "SOURCE_CAPTURE_EVIDENCE";
  manifest: OperationalBackupManifest;
  manifestSha256: string;
  verifiedPmObjectCount: number;
};

function sourceEvidenceFromPreflight(
  value: OperationalBackupSourcePreflight,
  intent: OperationalBackupCaptureIntent
): OperationalBackupSourceCaptureEvidence {
  try {
    const manifest = operationalBackupManifestSchema.parse(value.manifest);
    const manifestSha256 = createHash("sha256").update(canonicalOperationalBackupManifestBytes(manifest)).digest("hex");
    if (manifest.backupId !== intent.backupId || manifest.createdAt !== intent.createdAt
      || manifest.writeStopConfirmed !== intent.writeStopConfirmed
      || manifest.postgresDump.identity !== intent.postgresDump.identity
      || manifest.postgresDump.sha256 !== intent.postgresDump.sha256
      || manifest.postgresDump.byteLength !== intent.postgresDump.byteLength
      || value.manifestSha256 !== manifestSha256 || value.verifiedPmObjectCount !== manifest.pmObjects.length) {
      throw new Error("SOURCE_PREFLIGHT_INVALID");
    }
    return { kind: "SOURCE_CAPTURE_EVIDENCE", manifest, manifestSha256, verifiedPmObjectCount: manifest.pmObjects.length };
  } catch {
    throw new OperationalBackupCaptureError("SOURCE_PREFLIGHT_INVALID");
  }
}

function captureIntent(runIntent: OperationalBackupRunIntent, postgresDump: unknown): OperationalBackupCaptureIntent {
  try {
    return operationalBackupCaptureIntentSchema.parse({
      ...runIntent,
      postgresDump: operationalBackupPostgresDumpSchema.parse(postgresDump)
    });
  } catch {
    throw new OperationalBackupCaptureError("DUMP_UNAVAILABLE");
  }
}

function operationState(
  phase: OperationalBackupOperationState["phase"],
  runIntent: OperationalBackupRunIntent,
  evidence?: Pick<OperationalBackupSourceCaptureEvidence, "manifest" | "manifestSha256" | "verifiedPmObjectCount">
): OperationalBackupOperationState {
  if (phase === "DUMP_PENDING") {
    return normalizeOperationalBackupOperationState({
      formatVersion: 1,
      backupId: runIntent.backupId,
      phase,
      manifestSha256: null,
      storeIds: []
    });
  }
  if (!evidence) throw new OperationalBackupCaptureError("OPERATION_STATE_FAILED");
  return normalizeOperationalBackupOperationState({
    formatVersion: 1,
    backupId: evidence.manifest.backupId,
    phase,
    manifestSha256: evidence.manifestSha256,
    storeIds: [...new Set(evidence.manifest.pmObjects.map(object => object.storeId))]
  });
}

async function recordOperationState(
  ports: Pick<OperationalBackupCapturePorts, "recordOperationState">,
  state: OperationalBackupOperationState
): Promise<void> {
  try {
    await ports.recordOperationState(state);
  } catch {
    throw new OperationalBackupCaptureError("OPERATION_STATE_FAILED");
  }
}

/**
 * Captures and validates only the trusted source side of an operational
 * backup. The returned manifest/hash/count are source evidence, not a backup
 * receipt: target preparation, replication, cleanup and restore are pending.
 */
export async function captureOperationalBackupSource(
  input: unknown,
  source: OperationalBackupSourcePreflightRunner,
  ports: Pick<OperationalBackupCapturePorts, "createPostgresDump" | "recordOperationState">
): Promise<OperationalBackupSourceCaptureEvidence> {
  const runIntent = operationalBackupRunIntentSchema.parse(input);
  await recordOperationState(ports, operationState("DUMP_PENDING", runIntent));

  let dump: unknown;
  try {
    dump = await ports.createPostgresDump();
  } catch {
    throw new OperationalBackupCaptureError("DUMP_UNAVAILABLE");
  }
  const intent = captureIntent(runIntent, dump);

  let evidence: OperationalBackupSourceCaptureEvidence;
  try {
    evidence = sourceEvidenceFromPreflight(await source.prepare(intent), intent);
  } catch (error) {
    if (error instanceof OperationalBackupCaptureError) throw error;
    throw new OperationalBackupCaptureError("SOURCE_PREFLIGHT_FAILED");
  }

  await recordOperationState(ports,
    operationState("TARGET_PREPARATION_PENDING", runIntent, evidence));
  return evidence;
}

/**
 * Runs source capture, target preparation, and the managed replication/cleanup
 * port. The final proof gates a receipt containing no private manifest data.
 */
export async function captureOperationalBackup(
  input: unknown,
  source: OperationalBackupSourcePreflightRunner,
  ports: OperationalBackupCapturePorts
): Promise<OperationalBackupCaptureReceipt> {
  const runIntent = operationalBackupRunIntentSchema.parse(input);
  const evidence = await captureOperationalBackupSource(runIntent, source, ports);

  const storeIds = new Set(evidence.manifest.pmObjects.map(object => object.storeId));
  if (storeIds.size !== 1) {
    throw new OperationalBackupCaptureError("SOURCE_STORE_UNSUPPORTED");
  }

  try {
    await ports.prepareEmptyTarget(evidence);
  } catch {
    throw new OperationalBackupCaptureError("TARGET_PREPARATION_FAILED");
  }

  try {
    await ports.replicateAndCleanup(evidence);
  } catch {
    throw new OperationalBackupCaptureError("REPLICATION_FAILED");
  }

  try {
    const completion = await ports.verifyCompletion(evidence);
    if (completion.backupId !== evidence.manifest.backupId
      || completion.manifestSha256 !== evidence.manifestSha256
      || completion.verifiedPmObjectCount !== evidence.verifiedPmObjectCount) {
      throw new Error("FINAL_VERIFICATION_INVALID");
    }
  } catch {
    throw new OperationalBackupCaptureError("FINAL_VERIFICATION_FAILED");
  }

  return {
    backupId: evidence.manifest.backupId,
    manifestSha256: evidence.manifestSha256,
    verifiedPmObjectCount: evidence.verifiedPmObjectCount
  };
}

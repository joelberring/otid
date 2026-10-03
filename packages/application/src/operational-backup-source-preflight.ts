import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  canonicalOperationalBackupManifestBytes,
  normalizeOperationalBackupManifest,
  operationalBackupCaptureIntentSchema,
  type OperationalBackupManifest,
  type OperationalBackupPmObject
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { readAppliedMigrationIdentity, readOperationalBackupPmObjects } from "./operational-backup-read-model";

export class OperationalBackupSourcePreflightError extends Error {
  constructor(readonly code: "PM_REFERENCES_EMPTY" | "PM_OBJECT_VERIFICATION_FAILED") {
    super(code);
    this.name = "OperationalBackupSourcePreflightError";
  }
}

/** Infrastructure adapts this port to the existing version-bound PM reader. */
export type OperationalBackupPmVerifier = {
  verify(pmObject: OperationalBackupPmObject): Promise<void>;
};

export type OperationalBackupSourceEvidence = {
  migrationIdentity: string;
  pmObjects: readonly OperationalBackupPmObject[];
};

export type OperationalBackupSourcePreflight = {
  manifest: OperationalBackupManifest;
  manifestSha256: string;
  verifiedPmObjectCount: number;
};

/**
 * Collects the database half of a backup preflight in one read-only snapshot.
 * The caller must have established the separately declared writer stop first.
 */
export async function readOperationalBackupSourceEvidence(
  db: Database
): Promise<OperationalBackupSourceEvidence> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    const [migrationIdentity, pmObjects] = await Promise.all([
      readAppliedMigrationIdentity(tx),
      readOperationalBackupPmObjects(tx)
    ]);
    return { migrationIdentity, pmObjects };
  });
}

/**
 * Validates collected evidence and reads every immutable PM object through an
 * injected port. This module neither knows nor chooses object-store transport.
 */
export async function completeOperationalBackupSourcePreflight(
  captureIntent: unknown,
  evidence: { migrationIdentity: unknown; pmObjects: unknown },
  verifier: OperationalBackupPmVerifier
): Promise<OperationalBackupSourcePreflight> {
  const intent = operationalBackupCaptureIntentSchema.parse(captureIntent);
  const manifest = normalizeOperationalBackupManifest({
    ...intent,
    migrationIdentity: evidence.migrationIdentity,
    pmObjects: evidence.pmObjects
  });
  if (manifest.pmObjects.length === 0) {
    throw new OperationalBackupSourcePreflightError("PM_REFERENCES_EMPTY");
  }
  for (const pmObject of manifest.pmObjects) {
    try {
      await verifier.verify(pmObject);
    } catch {
      throw new OperationalBackupSourcePreflightError("PM_OBJECT_VERIFICATION_FAILED");
    }
  }
  const bytes = canonicalOperationalBackupManifestBytes(manifest);
  return {
    manifest,
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
    verifiedPmObjectCount: manifest.pmObjects.length
  };
}

/**
 * Parses operator intent before it reads PostgreSQL, then completes the
 * version-bound PM checks against evidence from the one source snapshot.
 */
export async function prepareOperationalBackupSourcePreflight(
  db: Database,
  captureIntent: unknown,
  verifier: OperationalBackupPmVerifier
): Promise<OperationalBackupSourcePreflight> {
  const intent = operationalBackupCaptureIntentSchema.parse(captureIntent);
  const evidence = await readOperationalBackupSourceEvidence(db);
  return completeOperationalBackupSourcePreflight(intent, evidence, verifier);
}

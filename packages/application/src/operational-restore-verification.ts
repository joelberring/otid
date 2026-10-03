import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { canonicalOperationalBackupManifestBytes, operationalBackupManifestSchema, operationalBackupPmObjectSchema, operationalBackupPostgresDumpSchema, type OperationalBackupManifest, type OperationalBackupPmObject, type OperationalBackupPostgresDump } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { readAppliedMigrationIdentity, readOperationalBackupPmObjects } from "./operational-backup-read-model";

export class OperationalRestoreVerificationError extends Error {
  constructor(readonly code: "MANIFEST_INVALID" | "POSTGRES_DUMP_VERIFICATION_FAILED" | "PM_OBJECT_VERIFICATION_FAILED" | "MIGRATION_MISMATCH" | "POSTGIS_MISSING" | "PM_REFERENCE_MISMATCH" | "HISTORY_INCOMPLETE") {
    super(code);
    this.name = "OperationalRestoreVerificationError";
  }
}

export type OperationalRestoreDatabaseEvidence = {
  migrationIdentity: string;
  pmObjects: readonly OperationalBackupPmObject[];
  history: {
    events: number;
    races: number;
    entries: number;
    rawDeviceMessages: number;
    cardReadouts: number;
    resultRevisions: number;
    auditEvents: number;
    resultFinalizations: number;
  };
};

/** The infrastructure adapter must read the exact manifest-bound object version. */
export type OperationalRestorePmVerifier = {
  verify(pmObject: OperationalBackupPmObject): Promise<void>;
};

/** Measures an already-supplied private dump; application checks its evidence. */
export type OperationalRestoreDumpReader = {
  measure(): Promise<OperationalBackupPostgresDump>;
};

/** Keeps the restore order testable while the concrete database reader stays here. */
export type OperationalRestoreDatabaseEvidenceVerifier = {
  verify(backupManifest: OperationalBackupManifest): Promise<OperationalRestoreDatabaseEvidence>;
};

export type OperationalRestoreReceipt = {
  manifestSha256: string;
  verifiedPmObjectCount: number;
  databaseEvidence: OperationalRestoreDatabaseEvidence;
};

function count(value: unknown): number {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) throw new OperationalRestoreVerificationError("HISTORY_INCOMPLETE");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new OperationalRestoreVerificationError("HISTORY_INCOMPLETE");
  return parsed;
}

function samePmReferences(left: readonly OperationalBackupPmObject[], right: readonly OperationalBackupPmObject[]): boolean {
  return left.length === right.length && left.every((value, index) => {
    const other = right[index];
    return other !== undefined && value.storeId === other.storeId && value.key === other.key
      && value.versionId === other.versionId && value.sha256 === other.sha256 && value.byteLength === other.byteLength;
  });
}

/** Validates secret-free evidence collected solely through read-only queries. */
export function validateOperationalRestoreDatabaseEvidence(
  backupManifest: unknown,
  evidence: { migrationIdentity: unknown; pmObjects: unknown; postgis: unknown; history: unknown },
): OperationalRestoreDatabaseEvidence {
  const manifest = operationalBackupManifestSchema.parse(backupManifest);
  const migrationIdentity = evidence.migrationIdentity;
  if (typeof migrationIdentity !== "string") throw new OperationalRestoreVerificationError("MIGRATION_MISMATCH");
  if (migrationIdentity !== manifest.migrationIdentity) throw new OperationalRestoreVerificationError("MIGRATION_MISMATCH");
  if (evidence.postgis !== true) throw new OperationalRestoreVerificationError("POSTGIS_MISSING");
  if (!Array.isArray(evidence.pmObjects)) throw new OperationalRestoreVerificationError("PM_REFERENCE_MISMATCH");
  let pmObjects: OperationalBackupPmObject[];
  try { pmObjects = evidence.pmObjects.map((value) => operationalBackupPmObjectSchema.parse(value)); }
  catch { throw new OperationalRestoreVerificationError("PM_REFERENCE_MISMATCH"); }
  if (!samePmReferences(pmObjects, manifest.pmObjects)) throw new OperationalRestoreVerificationError("PM_REFERENCE_MISMATCH");
  if (typeof evidence.history !== "object" || evidence.history === null || Array.isArray(evidence.history)) {
    throw new OperationalRestoreVerificationError("HISTORY_INCOMPLETE");
  }
  const row = evidence.history as Record<string, unknown>;
  const history = {
    events: count(row.events), races: count(row.races), entries: count(row.entries),
    rawDeviceMessages: count(row.rawDeviceMessages), cardReadouts: count(row.cardReadouts),
    resultRevisions: count(row.resultRevisions), auditEvents: count(row.auditEvents),
    resultFinalizations: count(row.resultFinalizations),
  };
  if (Object.values(history).some((value) => value < 1) || pmObjects.length < 1) {
    throw new OperationalRestoreVerificationError("HISTORY_INCOMPLETE");
  }
  return { migrationIdentity, pmObjects, history };
}

/**
 * Reads only the evidence that a restored database still contains a complete
 * small competition chain. PM bytes are deliberately not read here: that
 * requires the separate, version-ID-preserving object restore decision.
 */
export async function verifyOperationalRestoreDatabase(
  db: Database,
  backupManifest: unknown,
): Promise<OperationalRestoreDatabaseEvidence> {
  return db.transaction(async (tx) => {
    // One immutable snapshot prevents an in-progress restore or ingest from
    // combining evidence from different points in time. This function never
    // performs a write, even if its caller accidentally passes a writable DB.
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    const [migrationIdentity, pmObjects, postgis, counts] = await Promise.all([
      readAppliedMigrationIdentity(tx),
      readOperationalBackupPmObjects(tx),
      tx.execute(sql`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS present`),
      tx.execute(sql`
        SELECT
          (SELECT count(*)::text FROM event) AS "events",
          (SELECT count(*)::text FROM race) AS "races",
          (SELECT count(*)::text FROM entry) AS "entries",
          (SELECT count(*)::text FROM raw_device_message) AS "rawDeviceMessages",
          (SELECT count(*)::text FROM card_readout) AS "cardReadouts",
          (SELECT count(*)::text FROM result_revision) AS "resultRevisions",
          (SELECT count(*)::text FROM audit_event) AS "auditEvents",
          (SELECT count(*)::text FROM result_finalization) AS "resultFinalizations"
      `),
    ]);
    const postgisRow = postgis.rows[0] as { present?: unknown } | undefined;
    const row = counts.rows[0];
    return validateOperationalRestoreDatabaseEvidence(backupManifest, {
      migrationIdentity, pmObjects, postgis: postgisRow?.present, history: row,
    });
  });
}

function parseRestoreManifest(value: unknown): OperationalBackupManifest {
  const parsed = operationalBackupManifestSchema.safeParse(value);
  if (!parsed.success) throw new OperationalRestoreVerificationError("MANIFEST_INVALID");
  return parsed.data;
}

/**
 * Composes dump, target object and database evidence in ADR-0140's order.
 * It has no write path: callers inject an already-open dump reader, an exact
 * version-bound PM reader and a read-only database verifier.
 */
export async function verifyOperationalRestoreTarget(
  backupManifest: unknown,
  dumpReader: OperationalRestoreDumpReader,
  pmVerifier: OperationalRestorePmVerifier,
  databaseVerifier: OperationalRestoreDatabaseEvidenceVerifier,
): Promise<OperationalRestoreReceipt> {
  const manifest = parseRestoreManifest(backupManifest);
  try {
    const rawMeasured = await dumpReader.measure();
    const measured = operationalBackupPostgresDumpSchema.parse(rawMeasured);
    if (rawMeasured.identity !== manifest.postgresDump.identity || measured.sha256 !== manifest.postgresDump.sha256 ||
      measured.byteLength !== manifest.postgresDump.byteLength) {
      throw new OperationalRestoreVerificationError("POSTGRES_DUMP_VERIFICATION_FAILED");
    }
  } catch {
    throw new OperationalRestoreVerificationError("POSTGRES_DUMP_VERIFICATION_FAILED");
  }
  for (const pmObject of manifest.pmObjects) {
    try {
      await pmVerifier.verify(pmObject);
    } catch {
      throw new OperationalRestoreVerificationError("PM_OBJECT_VERIFICATION_FAILED");
    }
  }
  const databaseEvidence = await databaseVerifier.verify(manifest);
  return {
    manifestSha256: createHash("sha256").update(canonicalOperationalBackupManifestBytes(manifest)).digest("hex"),
    verifiedPmObjectCount: manifest.pmObjects.length,
    databaseEvidence,
  };
}

/**
 * Production-facing read-only restore verification. It verifies measured
 * dump metadata, not dump format or that the target was restored from it.
 * All dump/restore execution and object-store writes remain separate ports.
 */
export async function verifyOperationalRestore(
  db: Database,
  backupManifest: unknown,
  dumpReader: OperationalRestoreDumpReader,
  pmVerifier: OperationalRestorePmVerifier,
): Promise<OperationalRestoreReceipt> {
  return verifyOperationalRestoreTarget(backupManifest, dumpReader, pmVerifier, {
    verify: (manifest) => verifyOperationalRestoreDatabase(db, manifest),
  });
}

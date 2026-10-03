import { sql } from "drizzle-orm";
import { pmObjectManifestSchema, type OperationalBackupPmObject } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";

/** The read-only subset shared by a database handle and a Drizzle transaction. */
export type OperationalBackupReadExecutor = Pick<Database, "execute">;

const sha256 = /^[a-f0-9]{64}$/;

function sortKey(value: OperationalBackupPmObject): string {
  return `${value.storeId}\u0000${value.key}\u0000${value.versionId}`;
}

/**
 * Converts database rows to the secret-free backup references.  This is
 * deliberately strict: a malformed row must stop backup planning rather than
 * produce a manifest which silently omits or changes an object version.
 */
export function mapOperationalBackupPmObjects(rows: unknown): OperationalBackupPmObject[] {
  if (!Array.isArray(rows)) throw new Error("PM_MANIFEST_ROWS_INVALID");
  const mapped = rows.map((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("PM_MANIFEST_ROW_INVALID");
    }
    const candidate = row as Record<string, unknown>;
    const parsed = pmObjectManifestSchema.safeParse({
      formatVersion: 1,
      storeId: candidate.storeId,
      key: candidate.objectKey ?? candidate.key,
      versionId: candidate.versionId,
      sha256: candidate.sha256,
      byteLength: candidate.byteLength
    });
    if (!parsed.success) throw new Error("PM_MANIFEST_ROW_INVALID");
    return {
      storeId: parsed.data.storeId,
      key: parsed.data.key,
      versionId: parsed.data.versionId,
      sha256: parsed.data.sha256,
      byteLength: parsed.data.byteLength
    };
  });

  const references = new Set(mapped.map(sortKey));
  if (references.size !== mapped.length) throw new Error("PM_MANIFEST_DUPLICATE");
  return mapped.sort((left, right) => sortKey(left).localeCompare(sortKey(right), "en"));
}

/**
 * Drizzle's PostgreSQL migrator records only the applied hash in
 * drizzle.__drizzle_migrations; migration tags live in the checked-in journal and are
 * not recoverable from the database alone.  The hash is therefore the only
 * honest installation identity available to this read-only model.
 */
export function appliedMigrationIdentityFromRow(row: unknown): string {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("MIGRATION_IDENTITY_UNKNOWN");
  }
  const candidate = row as Record<string, unknown>;
  if (typeof candidate.hash !== "string" || !sha256.test(candidate.hash)) {
    throw new Error("MIGRATION_IDENTITY_UNKNOWN");
  }
  return `drizzle:${candidate.hash}`;
}

/** Reads, but never writes, the latest actually applied Drizzle migration. */
export async function readAppliedMigrationIdentity(db: OperationalBackupReadExecutor): Promise<string> {
  const result = await db.execute(sql`
    SELECT hash
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  const rows = result.rows as unknown[];
  if (rows.length !== 1) throw new Error("MIGRATION_IDENTITY_UNKNOWN");
  return appliedMigrationIdentityFromRow(rows[0]);
}

/** Reads all PM manifest rows in a stable order; this query is read-only. */
export async function readOperationalBackupPmObjects(db: OperationalBackupReadExecutor): Promise<OperationalBackupPmObject[]> {
  const result = await db.execute(sql`
    SELECT store_id AS "storeId", object_key AS "objectKey", version_id AS "versionId", sha256, byte_length AS "byteLength"
    FROM pm_object_manifest
    ORDER BY store_id ASC, object_key ASC, version_id ASC
  `);
  return mapOperationalBackupPmObjects(result.rows);
}

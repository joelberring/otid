import { z } from "zod";
import { canonicalJsonBytes } from "./canonical-json";
import { pmObjectManifestSchema } from "./pm-object-manifest";

const canonicalUuid = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "UUID måste vara kanoniskt och skrivet med gemener"
);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "SHA-256 måste vara 64 hextecken i gemener");
const byteLength = z.number().int().positive().safe();
const nonEmptyIdentity = z.string().trim().min(1).max(512);

/** The exact immutable PM object reference stored in an operational backup. */
export const operationalBackupPmObjectSchema = pmObjectManifestSchema.omit({ formatVersion: true });

export const operationalBackupPostgresDumpSchema = z.object({
  identity: nonEmptyIdentity,
  sha256,
  byteLength
}).strict();

/**
 * Operator-supplied evidence that can be validated before any database or PM
 * object read. It deliberately says nothing about how the dump was produced.
 */
export const operationalBackupCaptureIntentSchema = z.object({
  backupId: canonicalUuid,
  createdAt: z.iso.datetime({ offset: true }),
  writeStopConfirmed: z.literal(true),
  postgresDump: operationalBackupPostgresDumpSchema
}).strict();

/**
 * The operator intent checked before a private backup worker creates its dump.
 * The dump evidence is produced by that worker and added only afterwards.
 */
export const operationalBackupRunIntentSchema = operationalBackupCaptureIntentSchema
  .omit({ postgresDump: true })
  .strict();

/**
 * A secret-free, installation-wide backup binding. Shape validation does not
 * prove that the referenced dump or objects exist; the restore workflow does.
 */
export const operationalBackupManifestSchema = z.object({
  formatVersion: z.literal(1),
  backupId: canonicalUuid,
  createdAt: z.iso.datetime({ offset: true }),
  writeStopConfirmed: z.literal(true),
  postgresDump: operationalBackupPostgresDumpSchema,
  migrationIdentity: nonEmptyIdentity,
  pmObjects: z.array(operationalBackupPmObjectSchema).max(100_000)
}).strict().superRefine((manifest, context) => {
  const references = manifest.pmObjects.map((object) => `${object.storeId}\u0000${object.key}\u0000${object.versionId}`);
  if (new Set(references).size !== references.length) {
    context.addIssue({ code: "custom", path: ["pmObjects"], message: "PM-objekt får inte dupliceras" });
  }
});

export type OperationalBackupManifest = z.infer<typeof operationalBackupManifestSchema>;
export type OperationalBackupPmObject = z.infer<typeof operationalBackupPmObjectSchema>;
export type OperationalBackupPostgresDump = z.infer<typeof operationalBackupPostgresDumpSchema>;
export type OperationalBackupCaptureIntent = z.infer<typeof operationalBackupCaptureIntentSchema>;
export type OperationalBackupRunIntent = z.infer<typeof operationalBackupRunIntentSchema>;

function referenceSortKey(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  const record = value as Record<string, unknown>;
  return [record.storeId, record.key, record.versionId]
    .map((part) => typeof part === "string" ? part : "")
    .join("\u0000");
}

function compareReferenceKeys(left: unknown, right: unknown): number {
  const a = referenceSortKey(left);
  const b = referenceSortKey(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Parses a backup binding and puts PM object references in the one stable
 * order used for canonical bytes. It performs no I/O or hashing.
 */
export function normalizeOperationalBackupManifest(input: unknown): OperationalBackupManifest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return operationalBackupManifestSchema.parse(input);
  }
  const candidate = input as Record<string, unknown>;
  if (candidate.formatVersion !== undefined && candidate.formatVersion !== 1) {
    return operationalBackupManifestSchema.parse(input);
  }
  const pmObjects = Array.isArray(candidate.pmObjects)
    ? Array.from(candidate.pmObjects as unknown[]).sort(compareReferenceKeys)
    : candidate.pmObjects;
  return operationalBackupManifestSchema.parse({ ...candidate, formatVersion: 1, pmObjects });
}

/** Returns canonical UTF-8 JSON bytes for stable signing and hashing. */
export function canonicalOperationalBackupManifestBytes(
  manifest: OperationalBackupManifest
): Uint8Array {
  const parsed = operationalBackupManifestSchema.parse(manifest);
  return canonicalJsonBytes(parsed);
}

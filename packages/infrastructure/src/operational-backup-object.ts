import { createHash } from "node:crypto";
import { operationalBackupPmObjectSchema, type OperationalBackupPmObject } from "@o-tid/contracts";
import { PmObjectStorageError, type PmObjectManifest } from "./pm-object-store";

/** The smallest surface needed by the backup reader; the real PM store is one implementation. */
export type PmObjectReader = {
  read(input: unknown, signal?: AbortSignal): Promise<Buffer>;
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Reads one immutable PM object referenced by an operational-backup manifest.
 * The version is passed through to the existing object-store read primitive,
 * and the returned bytes are checked again at this boundary.
 */
export async function readOperationalBackupPmObject(
  reader: PmObjectReader,
  input: unknown,
  signal?: AbortSignal
): Promise<Buffer> {
  const parsed = operationalBackupPmObjectSchema.safeParse(input);
  if (!parsed.success) throw new PmObjectStorageError();
  const manifest: PmObjectManifest = { formatVersion: 1, ...parsed.data };
  try {
    const bytes = await reader.read(manifest, signal);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== manifest.byteLength || sha256(bytes) !== manifest.sha256) {
      throw new PmObjectStorageError();
    }
    return Buffer.from(bytes);
  } catch {
    throw new PmObjectStorageError();
  }
}

/**
 * Adapts the sole version-bound PM byte reader to application backup
 * preflight. It intentionally exposes no storage endpoint or write method.
 */
export function createOperationalBackupPmVerifier(reader: PmObjectReader): {
  verify(pmObject: OperationalBackupPmObject): Promise<void>;
} {
  return {
    async verify(pmObject) {
      await readOperationalBackupPmObject(reader, pmObject);
    }
  };
}

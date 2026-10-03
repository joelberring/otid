import { createHash } from "node:crypto";
import {
  canonicalOperationalBackupManifestBytes,
  normalizeOperationalBackupManifest,
  type OperationalBackupManifest
} from "@o-tid/contracts";

/** Input collected by a backup runner; this module does not read any of it. */
export type OperationalBackupManifestInput = Omit<OperationalBackupManifest, "formatVersion">;

export type BuiltOperationalBackupManifest = {
  manifest: OperationalBackupManifest;
  bytes: Uint8Array;
  sha256: string;
};

/**
 * Builds the exact canonical manifest from already collected backup evidence.
 * It performs no I/O. PM references are sorted before schema validation so
 * equivalent input order always produces identical canonical bytes.
 */
export function buildOperationalBackupManifest(input: unknown): BuiltOperationalBackupManifest {
  const manifest = normalizeOperationalBackupManifest(input);
  const bytes = canonicalOperationalBackupManifestBytes(manifest);
  return {
    manifest,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

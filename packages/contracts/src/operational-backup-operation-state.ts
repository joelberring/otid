import { z } from "zod";
import { canonicalJsonBytes } from "./canonical-json";

const canonicalUuid = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "UUID måste vara kanoniskt och skrivet med gemener"
);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "SHA-256 måste vara 64 hextecken i gemener");
const storeIds = z.array(canonicalUuid).max(100_000);

const dumpPendingState = z.object({
  formatVersion: z.literal(1),
  backupId: canonicalUuid,
  phase: z.literal("DUMP_PENDING"),
  manifestSha256: z.null(),
  storeIds: storeIds.length(0)
}).strict();

const verifiedManifestState = z.object({
  formatVersion: z.literal(1),
  backupId: canonicalUuid,
  phase: z.enum(["TARGET_PREPARATION_PENDING", "REPLICATION_MAY_EXIST", "CLEANUP_REQUIRED", "CLEANUP_VERIFIED"]),
  manifestSha256: sha256,
  storeIds
}).strict();

/**
 * Secret-free recovery state for one ADR-0140 backup operation. It is written
 * by private infrastructure outside the manifest and never contains runtime
 * configuration, credentials, endpoints or target ARNs.
 */
export const operationalBackupOperationStateSchema = z.discriminatedUnion("phase", [
  dumpPendingState,
  verifiedManifestState
]).superRefine((state, context) => {
  if (new Set(state.storeIds).size !== state.storeIds.length) {
    context.addIssue({ code: "custom", path: ["storeIds"], message: "Store-id:n får inte dupliceras" });
  }
});

export type OperationalBackupOperationState = z.infer<typeof operationalBackupOperationStateSchema>;

/** Sorts the logical cleanup scope before strict validation and canonical serialization. */
export function normalizeOperationalBackupOperationState(input: unknown): OperationalBackupOperationState {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return operationalBackupOperationStateSchema.parse(input);
  }
  const candidate = input as Record<string, unknown>;
  const orderedStoreIds = Array.isArray(candidate.storeIds)
    ? Array.from(candidate.storeIds as unknown[]).sort((left, right) => String(left).localeCompare(String(right)))
    : candidate.storeIds;
  return operationalBackupOperationStateSchema.parse({ ...candidate, formatVersion: 1, storeIds: orderedStoreIds });
}

/** Returns canonical UTF-8 bytes for the state private infrastructure persists. */
export function canonicalOperationalBackupOperationStateBytes(input: unknown): Uint8Array {
  return canonicalJsonBytes(normalizeOperationalBackupOperationState(input));
}

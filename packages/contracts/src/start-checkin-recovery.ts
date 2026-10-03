import { z } from "zod";
import { canonicalJsonBytes } from "./canonical-json";

const canonicalUuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const canonicalUuidSchema = z.string().regex(
  new RegExp(`^${canonicalUuidPattern}$`),
  "Id måste vara ett kanoniskt gemener-UUID"
);
const positivePostgresIntegerSchema = z.number().int().positive().max(2_147_483_647);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Hash måste vara SHA-256 i gemener");

const recoveryItemSchema = z.object({
  requestId: canonicalUuidSchema,
  localSequence: positivePostgresIntegerSchema,
  contentHash: sha256Schema
}).strict();

export const StartCheckinRecoveryManifestSchema = z.object({
  formatVersion: z.literal(1),
  kind: z.literal("OTID_CHECKIN_RECOVERY_MANIFEST"),
  raceId: canonicalUuidSchema,
  deviceId: canonicalUuidSchema,
  actorCredentialId: canonicalUuidSchema,
  capability: z.enum(["START_CHECKIN", "FINISH_FOREST_WATCH"]),
  firstSequence: positivePostgresIntegerSchema,
  lastSequence: positivePostgresIntegerSchema,
  items: z.array(recoveryItemSchema).min(1).max(20_000)
}).strict().superRefine((manifest, context) => {
  if (manifest.lastSequence !== manifest.firstSequence + manifest.items.length - 1) {
    context.addIssue({
      code: "custom",
      path: ["lastSequence"],
      message: "Sekvensintervallet måste motsvara manifestets poster"
    });
  }

  for (const [index, item] of manifest.items.entries()) {
    if (item.localSequence !== manifest.firstSequence + index) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "localSequence"],
        message: "Manifestets poster måste ha strikt stigande sammanhängande sekvenser"
      });
    }
  }

  const requestIds = new Set(manifest.items.map((item) => item.requestId));
  if (requestIds.size !== manifest.items.length) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "Manifestets request-id måste vara unika"
    });
  }
});

export const StartCheckinRecoveryTokenSchema = z.string().regex(
  new RegExp(`^otid_checkin_recovery_v1\\.${canonicalUuidPattern}\\.[A-Za-z0-9_-]{43}$`)
);

/** Validates and serializes the exact frozen manifest; hashing is an adapter concern. */
export function canonicalStartCheckinRecoveryManifest(value: unknown): Uint8Array {
  return canonicalJsonBytes(StartCheckinRecoveryManifestSchema.parse(value));
}

export type StartCheckinRecoveryManifest = z.infer<typeof StartCheckinRecoveryManifestSchema>;

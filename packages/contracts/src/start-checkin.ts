import { z } from "zod";
import { canonicalJsonBytes } from "./canonical-json";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const postgresIntegerSchema = z.number().int().positive().max(2_147_483_647);
const nonnegativePostgresIntegerSchema = z.number().int().min(0).max(2_147_483_647);
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const canonicalUtcMillisecondSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
).refine((value) => {
  const year = Number(value.slice(0, 4));
  const milliseconds = Date.parse(value);
  return year >= 1 && year <= 9_999 && Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value;
}, "Tidpunkten måste vara en giltig kanonisk UTC-tid med millisekunder");

const startCheckinStateSchema = z.enum(["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"]);

const markStartActionSchema = z.object({
  kind: z.literal("MARK_START"),
  state: startCheckinStateSchema
}).strict();

const finishCorrectionActionSchema = z.object({
  kind: z.literal("FINISH_CORRECTION"),
  state: startCheckinStateSchema,
  manualReturnRegistered: z.boolean()
}).strict();

const startCheckinActionSchema = z.discriminatedUnion("kind", [
  markStartActionSchema,
  finishCorrectionActionSchema
]);

export const StartCheckinOperationSchema = z.object({
  formatVersion: z.literal(1),
  requestId: canonicalUuidSchema,
  dependsOnRequestId: canonicalUuidSchema.nullable(),
  deviceId: canonicalUuidSchema,
  actorCredentialId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  localSequence: postgresIntegerSchema,
  packageVersion: postgresIntegerSchema,
  expectedEntryVersion: postgresIntegerSchema,
  expectedRevision: nonnegativePostgresIntegerSchema,
  observedAt: canonicalUtcMillisecondSchema,
  action: startCheckinActionSchema
}).strict().superRefine((operation, context) => {
  if (operation.dependsOnRequestId === operation.requestId) {
    context.addIssue({
      code: "custom",
      path: ["dependsOnRequestId"],
      message: "En operation får inte bero på sig själv"
    });
  }
});

export const StartCheckinSyncRequestSchema = z.object({
  operation: StartCheckinOperationSchema,
  contentHash: contentHashSchema
}).strict();

const appliedEffectSchema = z.object({
  kind: z.literal("APPLIED"),
  revisionId: canonicalUuidSchema,
  revision: postgresIntegerSchema
}).strict();

const unchangedEffectSchema = z.object({
  kind: z.literal("UNCHANGED"),
  revision: nonnegativePostgresIntegerSchema
}).strict();

const conflictEffectSchema = z.object({
  kind: z.literal("CONFLICT"),
  revision: nonnegativePostgresIntegerSchema,
  reason: z.enum([
    "STALE_ENTRY",
    "STALE_PACKAGE",
    "STALE_REVISION",
    "DEPENDENCY_CONFLICT",
    "RETURN_ALREADY_REGISTERED",
    "RESULT_CONFLICT"
  ])
}).strict();

export const StartCheckinReceiptSchema = z.object({
  formatVersion: z.literal(1),
  storage: z.literal("STORED"),
  requestId: canonicalUuidSchema,
  deviceId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  localSequence: postgresIntegerSchema,
  contentHash: contentHashSchema,
  receivedAt: canonicalUtcMillisecondSchema,
  effect: z.discriminatedUnion("kind", [
    appliedEffectSchema,
    unchangedEffectSchema,
    conflictEffectSchema
  ])
}).strict();

/** Validates and serializes the frozen operation; hashing remains an adapter concern. */
export function canonicalStartCheckinOperation(value: unknown): Uint8Array {
  return canonicalJsonBytes(StartCheckinOperationSchema.parse(value));
}

export type StartCheckinOperation = z.infer<typeof StartCheckinOperationSchema>;
export type StartCheckinSyncRequest = z.infer<typeof StartCheckinSyncRequestSchema>;
export type StartCheckinReceipt = z.infer<typeof StartCheckinReceiptSchema>;

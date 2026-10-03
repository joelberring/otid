import { z } from "zod";
import { canonicalJsonBytes } from "./canonical-json";
import { StartCheckinOperationSchema, StartCheckinReceiptSchema } from "./start-checkin";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.number().int().min(0).max(2_147_483_647);
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(value => {
  const ms = Date.parse(value);
  return Number(value.slice(0, 4)) >= 1 && Number.isFinite(ms) && new Date(ms).toISOString() === value;
});
const conflictIds = z.array(uuid).min(1).max(1000).refine(ids => ids.every((id, index) => index === 0 || ids[index - 1]! < id),
  "Konflikt-id måste vara unika och sorterade");
const decision = z.literal("KEEP_CURRENT_STATE");

export const StartCheckinConflictReviewRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, entryId: uuid, sourceHash: hash,
  conflictRequestIds: conflictIds, decision,
  reason: z.string().min(1).max(500).refine(value => value.trim() === value)
}).strict();

export const StartCheckinConflictReviewResponseSchema = z.object({
  formatVersion: z.literal(1), reviewId: uuid, requestId: uuid, raceId: uuid, entryId: uuid,
  sourceHash: hash, conflictRequestIds: conflictIds, decision, reviewedAt: timestamp
}).strict();

const conflict = z.object({
  operation: StartCheckinOperationSchema, contentHash: hash, receipt: StartCheckinReceiptSchema,
  deviceLabel: z.string().min(1).max(120)
}).strict().superRefine((row, context) => {
  const op = row.operation, receipt = row.receipt;
  if (receipt.effect.kind !== "CONFLICT" || receipt.requestId !== op.requestId || receipt.entryId !== op.entryId ||
    receipt.raceId !== op.raceId || receipt.deviceId !== op.deviceId || receipt.localSequence !== op.localSequence || receipt.contentHash !== row.contentHash) {
    context.addIssue({ code: "custom", message: "Rapport och konfliktkvittens måste beskriva exakt samma operation" });
  }
});

/** Stable private review evidence. Read time and source hash are intentionally outside these bytes. */
export const StartCheckinConflictReviewSourceSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, entryId: uuid,
  displayName: z.string().max(321), className: z.string().max(160), organisationName: z.string().max(240).nullable(),
  snapshotVersion: counter.refine(value => value > 0), entryVersion: counter.refine(value => value > 0),
  revision: counter, resultRevision: counter,
  startState: z.enum(["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"]),
  manualReturnRegistered: z.boolean(), readoutReturnRegistered: z.boolean(), activeDns: z.boolean(),
  conflicts: z.array(conflict).max(1000)
}).strict().superRefine((source, context) => {
  if (source.revision === 0 && (source.startState !== "UNMARKED" || source.manualReturnRegistered)) {
    context.addIssue({ code: "custom", message: "Revision noll kan inte ange start eller manuell återkomst" });
  }
  if (source.conflicts.some((row, index) => row.operation.raceId !== source.raceId || row.operation.entryId !== source.entryId ||
    (index > 0 && source.conflicts[index - 1]!.operation.requestId >= row.operation.requestId))) {
    context.addIssue({ code: "custom", message: "Konflikterna måste ha rätt scope och sorterade unika request-id" });
  }
});

export const StartCheckinConflictReviewCandidateSchema = z.object({
  formatVersion: z.literal(1), sourceHash: hash, generatedAt: timestamp, source: StartCheckinConflictReviewSourceSchema
}).strict();

export const canonicalStartCheckinConflictReviewRequest = (value: unknown): Uint8Array => canonicalJsonBytes(StartCheckinConflictReviewRequestSchema.parse(value));
export const canonicalStartCheckinConflictReviewSource = (value: unknown): Uint8Array => canonicalJsonBytes(StartCheckinConflictReviewSourceSchema.parse(value));
export type StartCheckinConflictReviewRequest = z.infer<typeof StartCheckinConflictReviewRequestSchema>;
export type StartCheckinConflictReviewResponse = z.infer<typeof StartCheckinConflictReviewResponseSchema>;
export type StartCheckinConflictReviewSource = z.infer<typeof StartCheckinConflictReviewSourceSchema>;
export type StartCheckinConflictReviewCandidate = z.infer<typeof StartCheckinConflictReviewCandidateSchema>;

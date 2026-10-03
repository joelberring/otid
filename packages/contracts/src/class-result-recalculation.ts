import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const positive = z.number().int().positive();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const engine = z.string().trim().min(1).max(64);

export const classResultRecalculationReadinessSchema = z.enum([
  "READY", "CURRENT", "NO_ACTIVE_ASSIGNMENT", "MULTIPLE_ACTIVE_ASSIGNMENTS", "NO_READOUT", "NO_RESULT"
]);

const latestSchema = z.object({ id: uuid, revision: positive, snapshotVersion: positive }).strict();
export const classResultRecalculationCandidateEntrySchema = z.object({
  id: uuid, entryVersion: positive, displayName: z.string().trim().min(1).max(321),
  readiness: classResultRecalculationReadinessSchema,
  cardAssignmentId: uuid.nullable(), readoutId: uuid.nullable(), latestResultRevision: latestSchema.nullable()
}).strict();

export const classResultRecalculationCandidateResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, classId: uuid, className: z.string().trim().min(1).max(160),
  snapshotVersion: positive, engineVersion: engine, manifestHash: hash,
  entries: z.array(classResultRecalculationCandidateEntrySchema).max(10_000)
}).strict().superRefine((value, ctx) => {
  if (new Set(value.entries.map((entry) => entry.id)).size !== value.entries.length) {
    ctx.addIssue({ code: "custom", path: ["entries"], message: "Deltagare måste vara unika" });
  }
});

export const classResultRecalculationRequestSchema = z.object({
  formatVersion: z.literal(1), classId: uuid, snapshotVersion: positive, engineVersion: engine,
  manifestHash: hash, entryIds: z.array(uuid).min(1).max(100)
}).strict().superRefine((value, ctx) => {
  if (new Set(value.entryIds).size !== value.entryIds.length) ctx.addIssue({ code: "custom", path: ["entryIds"], message: "Deltagare måste vara unika" });
  if (value.entryIds.join("\0") !== [...value.entryIds].sort().join("\0")) ctx.addIssue({ code: "custom", path: ["entryIds"], message: "Deltagare måste vara kanoniskt UUID-sorterade" });
});

export const classResultRecalculationIdempotencyKeySchema = z.string().regex(
  /^class-result-recalculation:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
);

const itemSchema = z.object({ entryId: uuid, resultRevisionId: uuid, revision: positive }).strict();
export const classResultRecalculationResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, classId: uuid,
  manifestHash: hash, snapshotVersion: positive, engineVersion: engine,
  recalculatedAt: z.iso.datetime({ offset: true }), items: z.array(itemSchema).min(1).max(100)
}).strict();

export type ClassResultRecalculationCandidateResponse = z.infer<typeof classResultRecalculationCandidateResponseSchema>;
export type ClassResultRecalculationRequest = z.infer<typeof classResultRecalculationRequestSchema>;
export type ClassResultRecalculationResponse = z.infer<typeof classResultRecalculationResponseSchema>;

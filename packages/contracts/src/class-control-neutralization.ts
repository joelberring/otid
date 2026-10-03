import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.number().int().positive().max(2_147_483_647);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

const controlSchema = z.object({ id: uuid, sequence: positive, controlCode: positive }).strict();

export const classControlNeutralizationCandidateSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, classId: uuid,
  className: z.string().trim().min(1).max(160), courseVersionId: uuid,
  courseVersion: version, snapshotVersion: version, basisHash: sha256,
  controls: z.array(controlSchema).min(1).max(1_000),
  historicalResultRevisionCount: z.number().int().nonnegative().max(100_000), generatedAt: instant
}).strict().superRefine((value, context) => {
  if (value.controls.some((control, index) => control.sequence !== index + 1)) {
    context.addIssue({ code: "custom", path: ["controls"], message: "Kontrollförekomster måste följa sekvensen" });
  }
});

export const classControlNeutralizationRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, expectedSnapshotVersion: version,
  expectedBasisHash: sha256, classId: uuid, expectedCourseVersionId: uuid,
  courseControlId: uuid, sequence: positive, controlCode: positive,
  acknowledgedNoAutomaticRecalculation: z.literal(true)
}).strict();

export const classControlNeutralizationIdempotencyKeySchema = z.string().regex(
  /^class-control-neutralization:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
);

export const classControlNeutralizationResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, neutralizationId: uuid,
  raceId: uuid, classId: uuid, courseVersionId: uuid, courseControlId: uuid,
  sequence: positive, controlCode: positive, sourceSnapshotVersion: version,
  sourceBasisHash: sha256, snapshotVersionAfter: version,
  request: classControlNeutralizationRequestSchema, historicalResultRevisionCount: z.number().int().nonnegative().max(100_000), neutralizedAt: instant
}).strict().superRefine((value, context) => {
  if (value.requestId !== value.request.requestId || value.neutralizationId !== value.request.requestId ||
      value.classId !== value.request.classId || value.courseVersionId !== value.request.expectedCourseVersionId ||
      value.courseControlId !== value.request.courseControlId || value.sequence !== value.request.sequence ||
      value.controlCode !== value.request.controlCode || value.sourceSnapshotVersion !== value.request.expectedSnapshotVersion ||
      value.sourceBasisHash !== value.request.expectedBasisHash || value.snapshotVersionAfter !== value.sourceSnapshotVersion + 1) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda granskat intent och exakt kontrollförekomst" });
  }
});

export type ClassControlNeutralizationCandidate = z.infer<typeof classControlNeutralizationCandidateSchema>;
export type ClassControlNeutralizationRequest = z.infer<typeof classControlNeutralizationRequestSchema>;
export type ClassControlNeutralizationResponse = z.infer<typeof classControlNeutralizationResponseSchema>;
